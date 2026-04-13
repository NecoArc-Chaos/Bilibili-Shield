// ==UserScript==
// @name         Bilibili Omnipotent Shield (Bilibili 全能护盾) - Railgun Ultimate (Release)
// @namespace    http://tampermonkey.net/
// @version      1.3.1-Release
// @description  哔哩哔哩全能护盾 - 完美修复未登录查看评论功能 & 极致净化体验 (修复翻页/空指针/性能问题)
// @author       Sakurairinaqwq & DD1969 & Merged
// @match        *://*.bilibili.com/*
// @match        https://t.bilibili.com/*
// @match        https://space.bilibili.com/*
// @match        https://manga.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @connect      cdn.jsdelivr.net
// @connect      api.bilibili.com
// @connect      arkn.icu
// @require      https://update.greasyfork.org/scripts/510239/1454424/viewer.js
// @require      https://update.greasyfork.org/scripts/475332/1250588/spark-md5.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    /**
     * =================================================================
     * 核心配置 (Configuration)
     * =================================================================
     */
    const STATE = {
        logs: [], // 运行时日志存储
        isDevMode: GM_getValue('cfg_dev_mode', false) // 开发者模式开关
    };

    const CONFIG = {
        debug: true,
        // 云端规则订阅源 (用于同步最新的屏蔽词库)
        remoteBanListUrl: "https://arkn.icu/Bilibili-Shield/%E5%85%A8%E8%83%BD%E6%8A%A4%E7%9B%BE%E5%BA%93/%E8%BF%9D%E7%A6%81%E8%AF%8D/ban.json",
        updateInterval: 24 * 60 * 60 * 1000, // 自动更新间隔：24小时

        // 功能开关配置 (从本地存储读取，默认关闭以避免干扰)
        settings: {
            // --- 通用设置 ---
            blockLoginPopups: GM_getValue('cfg_blockLoginPopups', false), // 禁止自动弹出登录框

            // --- 护盾 (净化功能) ---
            blockAds: GM_getValue('cfg_blockAds', false),             // 拦截广告组件/占位符
            filterFeed: GM_getValue('cfg_filterFeed', false),         // 过滤首页推荐流
            filterComments: GM_getValue('cfg_filterComments', false), // 过滤评论区内容
            filterDanmaku: GM_getValue('cfg_filterDanmaku', false),   // 过滤视频弹幕
            autoBlockUser: GM_getValue('cfg_autoBlockUser', false),   // 自动拉黑触发屏蔽词的用户
            blockDefaultAvatars: GM_getValue('cfg_blockDefaultAvatars', false), // 屏蔽默认头像用户
            blockNews: GM_getValue('cfg_blockNews', false),           // 屏蔽新闻类关键词

            // --- UI (界面美化) ---
            pinkHeader: GM_getValue('cfg_pinkHeader', false),         // 恢复经典粉色顶栏
            hideCarousel: GM_getValue('cfg_hideCarousel', false),     // 隐藏首页轮播图
            hideFloorCard: GM_getValue('cfg_hideFloorCard', false),   // 隐藏底部推广卡片
            hideLeftLocEntry: GM_getValue('cfg_hideLeftLocEntry', false), // 隐藏左侧浮动入口

            // --- 解锁 (增强功能) ---
            unlockHighQuality: GM_getValue('cfg_unlockHighQuality', false), // 解锁1080P+画质
            preferQuality: GM_getValue('cfg_preferQuality', '1080'),        // 偏好画质选择
            waitHighQualityLoad: GM_getValue('cfg_waitHighQualityLoad', false), // 防音画不同步等待

            // [核心功能] 未登录查看评论
            unlockGuestComments: GM_getValue('cfg_unlockGuestComments', false),
            enableFanMedal: GM_getValue('cfg_enableFanMedal', true),    // 显示粉丝勋章
            enableNotePrefix: GM_getValue('cfg_enableNotePrefix', true), // 显示"笔记"前缀
        },

        // 本地规则库初始化
        rules: { black: { strings: new Set(), regex: [] }, white: { strings: new Set(), regex: [] } },
        localKeywords: ["免费教程", "实操变现", "日入", "加我", "v信", "淘宝", "兼职"], // 预设垃圾广屏蔽词
        newsKeywords: ["新闻", "资讯", "日报", "周刊", "快讯", "热点", "头条", "CCTV", "央视", "新华社", "人民日报", "环球网", "观察者网", "凤凰网", "澎湃", "财新", "路透", "BBC", "CNN", "联播", "时政", "民生", "外交部", "白宫", "俄乌", "巴以", "战争", "局势"]
    };

    /**
     * =================================================================
     * 模块：日志系统
     * =================================================================
     */
    const Logger = {
        push: (type, msg, data = null) => {
            const time = new Date().toLocaleTimeString();
            STATE.logs.push({ time, type, msg, data });
            if (STATE.logs.length > 200) STATE.logs.shift(); // 限制日志条数
            if (window._biliShieldUpdateLogs) window._biliShieldUpdateLogs();
            if (CONFIG.debug && STATE.isDevMode) console.log(`%c[Shield] ${msg}`, 'color:#FF6699', data || '');
        },
        info: (msg) => Logger.push('CONNECT', msg),
        warn: (msg) => Logger.push('WARNING', msg),
        block: (msg) => Logger.push('BLOCK', msg),
        action: (msg) => Logger.push('RAILGUN', msg),
        // 屏蔽 B 站自身的一些无用渲染报错
        suppressErrors: () => {
            const originalConsoleError = console.error;
            console.error = function(...args) {
                const str = args.map(a => String(a)).join(' ');
                if (str.includes("Cannot read properties of undefined") && str.includes("render")) return;
                originalConsoleError.apply(console, args);
            };
        }
    };

    /**
     * =================================================================
     * 模块：实用工具
     * =================================================================
     */
    const Utils = {
        // 等待 document.body 加载完成，防止脚本过早执行报错
        waitForBody: () => {
            return new Promise(resolve => {
                if (document.body) return resolve(document.body);
                const observer = new MutationObserver(() => {
                    if (document.body) {
                        observer.disconnect();
                        resolve(document.body);
                    }
                });
                observer.observe(document.documentElement, { childList: true });
            });
        }
    };

    /**
     * =================================================================
     * 模块：用户操作执行器
     * =================================================================
     */
    class UserActionManager {
        constructor() { this.csrfToken = this.getCsrf(); }
        // 获取 B 站 CSRF Token 用于 API 请求
        getCsrf() { const match = document.cookie.match(/bili_jct=([^;]+)/); return match ? match[1] : null; }

        // 执行拉黑操作
        blockUser(mid, username) {
            if (!this.csrfToken) { Logger.warn(`未登录，无法执行自动拉黑`); return; }
            if (sessionStorage.getItem(`shield_blocked_${mid}`)) return; // Session 缓存，避免重复请求

            GM_xmlhttpRequest({
                method: "POST",
                url: "https://api.bilibili.com/x/relation/modify",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": document.cookie },
                data: `fid=${mid}&act=5&re_src=11&csrf=${this.csrfToken}`,
                onload: (res) => {
                    try {
                        const json = JSON.parse(res.responseText);
                        if (json.code === 0) {
                            Logger.action(`自动拉黑: ${username}`);
                            Toast.success(`⚡ 已将 ${username} 移入黑名单`);
                            sessionStorage.setItem(`shield_blocked_${mid}`, '1');
                        }
                    } catch (e) {}
                }
            });
        }
    }

    /**
     * =================================================================
     * 模块：Toast 通知 (悬浮提示框)
     * =================================================================
     */
    class Toast {
        static async init() {
            if (document.getElementById('bili-shield-toast-container')) return;
            await Utils.waitForBody();
            const container = document.createElement('div');
            container.id = 'bili-shield-toast-container';
            container.style.cssText = "position: fixed; top: 100px; right: 20px; z-index: 2147483647; display: flex; flex-direction: column; gap: 12px; pointer-events: none; align-items: flex-end;";
            document.body.appendChild(container);

            // 注入 Toast 样式
            const style = document.createElement('style');
            style.textContent = `
                .bs-toast { background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(16px); padding: 12px 20px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 174, 236, 0.15); display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: bold; color: #444; border: 2px solid #FFF; border-left-width: 5px; opacity: 0; transform: translateX(30px) skewX(-5deg); animation: bsToastIn 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards; pointer-events: auto; min-width: 200px; font-family: "HarmonyOS Sans", "PingFang SC", sans-serif; }
                .bs-toast.hide { animation: bsToastOut 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards !important; }
                .bs-toast.success { border-left-color: #00AEEC; background: linear-gradient(to right, #F0FAFF, #FFF); }
                .bs-toast.error { border-left-color: #FF6699; background: linear-gradient(to right, #FFF0F5, #FFF); }
                .bs-toast.info { border-left-color: #F4A460; background: linear-gradient(to right, #FFF8F0, #FFF); }
                @keyframes bsToastIn { to { opacity: 1; transform: translateX(0) skewX(0); } }
                @keyframes bsToastOut { to { opacity: 0; transform: translateX(30px) scale(0.9); } }
            `;
            document.head.appendChild(style);
        }
        static async show(message, type = 'info') {
            await this.init();
            const container = document.getElementById('bili-shield-toast-container');
            if(!container) return;
            const toast = document.createElement('div');
            toast.className = `bs-toast ${type}`;
            let icon = type === 'success' ? '✨' : (type === 'error' ? '💥' : '⚡');
            toast.innerHTML = `<span style="font-size:18px">${icon}</span><span>${message}</span>`;
            container.appendChild(toast);
            setTimeout(() => { toast.classList.add('hide'); toast.addEventListener('animationend', () => toast.remove()); }, 3000);
        }
        static success(msg) { this.show(msg, 'success'); }
        static error(msg) { this.show(msg, 'error'); }
        static info(msg) { this.show(msg, 'info'); }
    }

    /**
     * =================================================================
     * 模块：规则管理器 (处理正则与关键词)
     * =================================================================
     */
    class RuleManager {
        constructor() { this.cacheKey = 'bili_shield_rules_v3'; this.lastUpdateKey = 'bili_shield_last_update'; }
        init() { this.loadFromCache(); this.checkUpdate(); }
        loadFromCache() { const rawData = GM_getValue(this.cacheKey, null); this.parseAndApply(rawData); Logger.info(`词库装载: B[${CONFIG.rules.black.strings.size}] W[${CONFIG.rules.white.strings.size}]`); }
        parseAndApply(json) {
            CONFIG.rules = { black: { strings: new Set(), regex: [] }, white: { strings: new Set(), regex: [] } };
            CONFIG.localKeywords.forEach(k => CONFIG.rules.black.strings.add(k));
            if (CONFIG.settings.blockNews) { CONFIG.newsKeywords.forEach(k => CONFIG.rules.black.strings.add(k)); }
            if (!json) return;
            let blackList = [], whiteList = [];
            if (Array.isArray(json)) blackList = json;
            else if (typeof json === 'object') { blackList = json.blacklist || json.ban || json.keywords || []; whiteList = json.whitelist || json.white || json.allow || []; }
            const process = (arr, target) => {
                if (!Array.isArray(arr)) return;
                arr.forEach(item => {
                    if (typeof item !== 'string' || !item.trim()) return;
                    item = item.trim();
                    // 识别正则格式 /.../
                    if (item.length > 2 && item.startsWith('/') && item.endsWith('/')) { try { target.regex.push(new RegExp(item.slice(1, -1))); } catch (e) { Logger.warn(`无效正则: ${item}`); } } else { target.strings.add(item); }
                });
            };
            process(blackList, CONFIG.rules.black); process(whiteList, CONFIG.rules.white);
            if (window._biliShieldUpdateStats) window._biliShieldUpdateStats();
        }
        forceUpdate() { Logger.info('同步云端数据...'); this.fetchRemoteList(true); }
        checkUpdate() { if (Date.now() - GM_getValue(this.lastUpdateKey, 0) > CONFIG.updateInterval) this.fetchRemoteList(); }
        fetchRemoteList(isManual = false) {
            GM_xmlhttpRequest({
                method: "GET", url: `${CONFIG.remoteBanListUrl}?t=${Date.now()}`, headers: { "Cache-Control": "no-cache" },
                onload: (res) => {
                    if (res.status !== 200) { if(isManual) Toast.error('连接超时'); return; }
                    try { let json = JSON.parse(res.responseText); GM_setValue(this.cacheKey, json); GM_setValue(this.lastUpdateKey, Date.now()); this.parseAndApply(json); if(isManual) Toast.success(`规则同步完成！`); }
                    catch (e) { const list = res.responseText.split(/[\r\n,]+/).map(s => s.trim()).filter(s=>s); GM_setValue(this.cacheKey, list); this.parseAndApply(list); if(isManual) Toast.success(`基础规则同步完成`); }
                }
            });
        }
        validate(txt) {
            if (!txt) return true;
            if (CONFIG.rules.white.strings.has(txt)) return true;
            for (let s of CONFIG.rules.white.strings) if (txt.includes(s)) return true;
            for (let r of CONFIG.rules.white.regex) if (r.test(txt)) return true;
            for (let s of CONFIG.rules.black.strings) if (txt.includes(s)) return false;
            for (let r of CONFIG.rules.black.regex) if (r.test(txt)) return false;
            return true;
        }
    }

    // === 智能清道夫 (清理 DOM 中的广告节点) ===
    class SmartCleaner {
        async init() {
            if (CONFIG.settings.blockAds !== true) return;
            const body = await Utils.waitForBody();
            const observer = new MutationObserver(() => this.cleanGhostCards());
            observer.observe(body, { childList: true, subtree: true });
            setInterval(() => this.cleanGhostCards(), 2500); // 定时兜底
        }
        cleanGhostCards() {
            const feedCards = document.querySelectorAll('.feed-card');
            feedCards.forEach(card => {
                if (card.style.display === 'none') return;
                const videoCard = card.querySelector('.bili-video-card');
                if (videoCard) {
                    const hasInfo = videoCard.querySelector('.bili-video-card__info');
                    const hasSkeleton = videoCard.querySelector('.bili-video-card__skeleton');
                    // 如果卡片没有信息区也没有骨架屏，通常是广告占位符
                    if (!hasInfo && !hasSkeleton) card.style.display = 'none';
                }
            });
        }
    }

    // === 弹幕拦截器 (DOM级实时拦截) ===
    class DanmakuCleaner {
        constructor(ruleManager) { this.ruleManager = ruleManager; }
        async init() {
            if (CONFIG.settings.filterDanmaku !== true) return;
            Logger.info("✅ 弹幕力场展开");
            const body = await Utils.waitForBody();
            const observer = new MutationObserver((mutations) => { mutations.forEach(m => m.addedNodes.forEach(node => { if (node.nodeType === 1) this.checkNode(node); })); });
            const playerObserver = new MutationObserver(() => {
                const dmLayer = document.querySelector('.b-danmaku') || document.querySelector('.bilibili-player-video-danmaku');
                if (dmLayer) { observer.observe(dmLayer, { childList: true, subtree: true }); dmLayer.querySelectorAll('*').forEach(n => this.checkNode(n)); }
            });
            playerObserver.observe(body, { childList: true, subtree: true });
        }
        checkNode(node) {
            if (!node.textContent) return;
            if (!this.ruleManager.validate(node.textContent)) { node.style.display = 'none'; node.style.visibility = 'hidden'; node.innerHTML = ''; }
        }
    }

    // === CSS 注入器 (样式修复核心) ===
    class CSSInjector {
        constructor() { this.styleId = 'bili-shield-global-css'; }
        init() { this.applyStyles(); this.injectUnlockStyles(); }

        // 注入护盾功能的通用样式
        applyStyles() {
            let css = '';
            if (CONFIG.settings.blockLoginPopups === true) { css += `.bili-mini-mask, .login-panel-popover, .bpx-player-toast-login, .vip-login-tip, .mini-login-shim, .v-popover-content:has(.login-panel-popover) { display: none !important; pointer-events: none !important; } body, html { overflow: auto !important; }`; }
            if (CONFIG.settings.blockAds === true) { css += `.adblock-tips, .bili-grid .video-card-common:has(.bili-video-card__info--ad), a[href*="cm.bilibili.com"], #slide_ad, .ad-report, .bili-video-card > div[class^="b0"] { display: none !important; } .feed-card:has(.bili-video-card:not(:has(.bili-video-card__info)):not(:has(.bili-video-card__skeleton))) { display: none !important; }`; }
            if (CONFIG.settings.pinkHeader === true) css += `.bili-header__bar { background-color: #F4A460 !important; } .bili-header .right-entry .right-entry-item { color: #fff !important; }`;
            if (CONFIG.settings.hideCarousel === true) css += `.recommended-swipe { display: none !important; }`;
            if (CONFIG.settings.hideFloorCard === true) css += `.floor-single-card { display: none !important; }`;
            if (CONFIG.settings.hideLeftLocEntry === true) css += `.left-loc-entry, .v-popover-wrap.left-loc-entry { display: none !important; }`;

            let style = document.getElementById(this.styleId);
            if (!style) { style = document.createElement('style'); style.id = this.styleId; document.head.appendChild(style); }
            style.textContent = css;
        }

        // [重点] 注入未登录评论区解锁所需的全部样式
        injectUnlockStyles() {
            if (CONFIG.settings.unlockGuestComments !== true) return;

            let css = `
            /* --- 评论区头部导航栏修复 (针对 "评论 | 最热 | 最新" 布局) --- */
            .comment-container .reply-header { margin-bottom: 24px; }
            .comment-container .nav-bar { display: flex; align-items: center; padding: 0; margin: 0; list-style: none; }
            .comment-container .nav-title { display: flex; align-items: center; font-size: 20px; font-weight: 500; color: #18191C; }
            .comment-container .total-reply { margin-left: 6px; font-size: 14px; color: #9499A0; font-weight: 400; }

            /* 排序按钮容器 */
            .comment-container .nav-sort { display: flex; align-items: center; margin-left: 40px; color: #9499A0; font-size: 14px; user-select: none; }
            .comment-container .nav-sort > div { cursor: pointer; transition: color 0.2s; }
            .comment-container .nav-sort > div:hover { color: #00AEEC; }
            .comment-container .nav-sort .part-symbol { height: 11px; border-left: 1px solid #9499A0; margin: 0 12px; opacity: 0.5; }

            /* 排序按钮高亮状态 */
            .comment-container .nav-sort.hot .hot-sort { color: #18191C; font-weight: 500; cursor: default; }
            .comment-container .nav-sort.time .time-sort { color: #18191C; font-weight: 500; cursor: default; }

            /* --- 评论列表项布局 --- */
            .reply-item { padding: 22px 0 14px 0; border-bottom: 1px solid #E3E5E7; }
            .reply-item .root-reply-container { display: flex; padding-left: 0; }
            .reply-item .root-reply-avatar { margin-right: 16px; position: relative; width: 48px; min-width: 48px; }
            .reply-item .root-reply-avatar .avatar { position: relative; width: 48px; height: 48px; }
            .reply-item .root-reply-avatar .avatar .bili-avatar { width: 48px; height: 48px; border-radius: 50%; border: 1px solid #F1F2F3; position: relative; }
            .reply-item .root-reply-avatar .bili-avatar-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
            .bili-avatar-pendent-dom { position: absolute; top: -17%; left: -17%; width: 135%; height: 135%; pointer-events: none; z-index: 1; }

            /* 评论内容区域 */
            .reply-item .content-warp { flex: 1; position: relative; }
            .reply-item .user-info { display: flex; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
            .reply-item .user-name { font-size: 13px; font-weight: 500; margin-right: 5px; color: #61666d; cursor: pointer; text-decoration: none; }
            .reply-item .user-name:hover { color: #00AEEC; }

            .reply-item .reply-content { font-size: 15px; line-height: 24px; color: #18191C; overflow: hidden; word-wrap: break-word; white-space: pre-wrap; display: block; }
            .reply-item .reply-info { display: flex; align-items: center; color: #9499A0; font-size: 13px; margin-top: 4px; }
            .reply-item .reply-like { margin-right: 18px; display: flex; align-items: center; }

            /* --- 子评论 (楼中楼) 布局 --- */
            .sub-reply-container { padding-left: 64px; margin-top: 10px; }
            .sub-reply-item { display: flex; padding: 8px 0; align-items: flex-start; }
            .sub-reply-item .sub-reply-avatar { margin-right: 10px; width: 24px; min-width: 24px; height: 24px; }
            .sub-reply-item .sub-reply-avatar img { width: 100%; height: 100%; border-radius: 50%; border: 1px solid #F1F2F3; }
            .sub-reply-content-box { flex: 1; font-size: 13px; line-height: 20px; }
            .sub-user-name { font-weight: 500; margin-right: 5px; cursor: pointer; color: #61666d; text-decoration: none; }
            .sub-user-name:hover { color: #00AEEC; }
            .sub-reply-info { font-size: 12px; color: #999; margin-top: 2px; }

            /* --- 粉丝勋章 --- */
            .fan-medal { display: inline-flex; align-items: center; height: 14px; margin-left: 2px; margin-right: 4px; border: 0.5px solid rgba(169, 195, 233, 0.18); border-radius: 10px; background-color: rgba(158, 186, 232, 0.2); vertical-align: middle; cursor: pointer; padding-right: 4px; }
            .fan-medal.fan-medal-with-guard-icon { border-color: #8da8e8; background-color: #b4ccff; }
            .fan-medal-icon { margin-right: -6px; width: 20px; height: 20px; overflow: clip; transform: translateX(-3px); object-fit: cover; }
            .fan-medal-name { margin-right: 2px; padding-left: 5px; line-height: 14px; white-space: nowrap; font-size: 9px; color: #577fb8; }
            .fan-medal-with-guard-icon > .fan-medal-name { color: #385599; }
            .fan-medal-level { display: flex; justify-content: center; align-items: center; margin-right: 0.5px; width: 12px; height: 12px; border-radius: 50%; line-height: 1; white-space: nowrap; font-family: sans-serif; font-size: 8px; transform: scale(0.85); color: #9ab0d2; background-color: #ffffff; }
            .fan-medal-with-guard-icon > .fan-medal-level { color: #5e80c4; }

            /* --- 分页器 --- */
            .page-switcher { display: flex; justify-content: center; margin: 30px 0; }
            .page-switcher-wrapper { display: flex; font-size: 14px; color: #666; user-select: none; align-items: center; }
            .page-switcher-wrapper span { margin: 0 4px; }
            .page-switcher-wrapper span:not(.page-switcher-current-page) { padding: 8px 16px; border: 1px solid #D7DDE4; border-radius: 4px; cursor: pointer; transition: 0.2s; background: #FFF; }
            .page-switcher-prev-btn:hover, .page-switcher-next-btn:hover { border-color: #00A1D6 !important; color: #00A1D6; }
            .page-switcher-current-page { color: white; background-color: #00A1D6; padding: 8px 16px; border-radius: 4px; cursor: default; }

            /* --- 通用工具类 --- */
            .jump-link { color: #008DDA; text-decoration: none; }
            .jump-link:hover { text-decoration: underline; }
            .note-prefix { display: inline-flex; align-items: center; color: #999; font-size: 12px; margin-right: 4px; vertical-align: middle; }

            /* --- 隐藏 B 站原版登录遮罩/弹窗 --- */
            .login-tip, .fixed-reply-box, .v-popover:has(.login-panel-popover) { display: none !important; }

            /* 屏幕适配 */
            @media screen and (max-width: 1620px) {
                .reply-item .root-reply-avatar { width: 40px; min-width: 40px; }
                .reply-item .root-reply-avatar .avatar, .reply-item .root-reply-avatar .avatar .bili-avatar { width: 40px; height: 40px; }
            }
            `;
            const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
        }
    }

    // === 网络拦截器 (拦截 API 数据) ===
    class NetworkInterceptor {
        constructor(ruleManager) {
            this.originalFetch = unsafeWindow.fetch;
            this.originalXHR = unsafeWindow.XMLHttpRequest;
            this.actionManager = new UserActionManager();
            this.ruleManager = ruleManager;
        }
        init() {
            const self = this;
            // 劫持 Fetch API
            unsafeWindow.fetch = async function(...args) {
                const url = args[0] instanceof Request ? args[0].url : args[0];
                // 广告域名拦截
                if (CONFIG.settings.blockAds === true && (url.includes('cm.bilibili.com') || url.includes('data.bilibili.com'))) return new Response(JSON.stringify({code:0,data:{}}));

                const response = await self.originalFetch.apply(this, args);
                // 针对评论区和推荐流的 API 进行二次处理
                if (url.includes('/x/web-interface/wbi/index/top/feed') || url.includes('/reply')) {
                    const clone = response.clone();
                    return self.processResponse(clone, url.includes('reply') ? 'comment' : 'feed');
                }
                return response;
            };
            // 劫持 XHR API
            unsafeWindow.XMLHttpRequest = class extends self.originalXHR {
                open(method, url) { this._url = url; super.open(method, url); }
                send(body) {
                    const originalReady = this.onreadystatechange;
                    this.onreadystatechange = function() {
                        if (this.readyState === 4 && this.status === 200 && self.isTarget(this._url)) {
                            try {
                                const data = JSON.parse(this.responseText);
                                const clean = self.cleanData(this._url.includes('reply') ? 'comment' : 'feed', data);
                                Object.defineProperty(this, 'responseText', { value: JSON.stringify(clean) });
                                Object.defineProperty(this, 'response', { value: JSON.stringify(clean) });
                            } catch(e) {}
                        }
                        if (originalReady) originalReady.apply(this, arguments);
                    };
                    super.send(body);
                }
            };
        }
        isTarget(url) { return url.includes('/reply') || url.includes('/feed/rcmd'); }
        async processResponse(res, type) { try { const data = await res.json(); return new Response(JSON.stringify(this.cleanData(type, data)), { status: res.status, headers: res.headers }); } catch(e) { return res; } }

        tryBlockUser(mid, name) { if (CONFIG.settings.autoBlockUser === true && mid) { this.actionManager.blockUser(mid, name); } }

        // 数据清洗核心逻辑
        cleanData(type, json) {
            if (!json || !json.data) return json;
            let count = 0;
            // 推荐流过滤
            if (type === 'feed' && CONFIG.settings.filterFeed === true && json.data.item) {
                const before = json.data.item.length;
                json.data.item = json.data.item.filter(item => {
                    if (['ad','live','game_card'].includes(item.goto)) return false;
                    if (!this.ruleManager.validate(item.title)) { if (item.owner) this.tryBlockUser(item.owner.mid, item.owner.name); return false; }
                    if (CONFIG.settings.blockDefaultAvatars === true && item.owner && /^bili_\d+$/.test(item.owner.name)) return false;
                    return true;
                });
                count = before - json.data.item.length;
            }
            // 评论区过滤
            else if (type === 'comment' && CONFIG.settings.filterComments === true && json.data.replies) {
                const filterReplies = (list) => list ? list.filter(r => {
                    if (!r || !r.content || !r.member) return false; // 空值保护
                    if (!this.ruleManager.validate(r.content.message)) { this.tryBlockUser(r.member.mid, r.member.uname); return false; }
                    if (CONFIG.settings.blockDefaultAvatars === true && /^bili_\d+$/.test(r.member.uname)) return false;
                    return true;
                }).map(r => { if(r.replies) r.replies = filterReplies(r.replies); return r; }) : [];
                const before = json.data.replies.length;
                json.data.replies = filterReplies(json.data.replies);
                count = before - json.data.replies.length;
            }
            if (count > 0) Logger.info(`过滤 ${count} 条${type==='feed'?'内容':'评论'}`);
            return json;
        }
    }

    /**
     * =================================================================
     * 模块：解锁管理器 (修复未登录查看评论)
     * =================================================================
     */
    class UnlockManager {
        constructor() {
            this.oid = null;
            this.createrID = null;
            this.commentType = null;
            this.replyList = null;
            this.sortType = 3; // 默认排序：3=热门, 2=最新
            this.offsetStore = {};
            this.replyPool = {};
        }

        init() {
            if (document.cookie.includes('DedeUserID')) return; // 已登录则不处理

            // 1080P 画质解锁
            if (CONFIG.settings.unlockHighQuality === true) {
                Logger.info("✅ 画质解锁");
                this.unlockQuality();
            } else {
                this.cleanQualityConfig();
            }

            // 评论解锁
            if (CONFIG.settings.unlockGuestComments === true) {
                Logger.info("✅ 评论解锁");
                this.startCommentUnlock();
                // 监听 URL 变化，适配 SPA 单页应用跳转
                let lastUrl = location.href;
                setInterval(() => {
                    if (lastUrl !== location.href) {
                        lastUrl = location.href;
                        this.startCommentUnlock();
                    }
                }, 1000);
            }
        }

        cleanQualityConfig() { try { localStorage.removeItem('bpx_player_profile'); localStorage.removeItem('bilibili_player_codec_prefer_type'); } catch(e) {} }

        // 模拟登录态以获取高画质
        unlockQuality() {
            ['bilibili_player_codec_prefer_type','b_miniplayer','recommend_auto_play','bpx_player_profile'].forEach(k=>{const v=GM_getValue(k);if(v)localStorage.setItem(k,v)});
            const originSetItem = localStorage.setItem;
            localStorage.setItem = function(k,v){ if(k==='bpx_player_profile'){try{const p=JSON.parse(v);if(!p.audioEffect)p.audioEffect={};v=JSON.stringify(p)}catch(e){}} originSetItem.call(this,k,v); };
            Object.defineProperty(Object.prototype, 'isViewToday', { get:()=>true, configurable:true });
            Object.defineProperty(Object.prototype, 'isVideoAble', { get:()=>true, configurable:true });
            const originSetTimeout = unsafeWindow.setTimeout;
            unsafeWindow.setTimeout = function(f,d){if(d===3e4)d=3e8;return originSetTimeout.call(this,f,d)};
            setInterval(()=>{
                const btn = document.querySelector('.bpx-player-toast-confirm-login');
                if(btn) {
                    btn.click();
                    if(CONFIG.settings.waitHighQualityLoad && unsafeWindow.player) { const el = unsafeWindow.player.mediaElement(); if(el && !el.paused) { el.pause(); setTimeout(()=>el.play(), 500); } }
                    setTimeout(()=>{ if(unsafeWindow.player) unsafeWindow.player.requestQuality({'1080':80,'720':64}[CONFIG.settings.preferQuality]||80); }, 5000);
                }
            }, 2000);
        }

        // --- 评论解锁核心逻辑 ---
        async startCommentUnlock() {
            this.oid = this.createrID = this.commentType = this.replyList = undefined;
            this.replyPool = {};
            this.sortType = 3;

            await this.setupStandardCommentContainer();
            await this.collectEssentialData();
            await this.enableSwitchingSortType();
            await this.loadFirstPagination();
        }

        // 确保页面上有一个标准的评论容器，如果没有则手动插入
        async setupStandardCommentContainer() {
            const container = await new Promise(resolve => {
                const timer = setInterval(() => {
                    const std = document.querySelector('.comment-container');
                    const shadow = document.querySelector('bili-comments');
                    const wrapper = document.querySelector('.comment-wrapper .common');
                    const target = std || shadow || wrapper;
                    if (target) { clearInterval(timer); resolve(target); }
                }, 200);
            });

            // 如果不是标准容器，则替换为标准结构，方便后续插入内容
            // 这里生成的 HTML 结构对应了 injectUnlockStyles 中的 CSS 选择器
            if (!container.classList.contains('comment-container')) {
                const newHTML = `
                    <div class="comment-container">
                      <div class="reply-header">
                        <div class="reply-navigation">
                          <ul class="nav-bar">
                            <li class="nav-title"><span class="nav-title-text">评论</span><span class="total-reply">-</span></li>
                            <li class="nav-sort hot"><div class="hot-sort">最热</div><div class="part-symbol"></div><div class="time-sort">最新</div></li>
                          </ul>
                        </div>
                      </div>
                      <div class="reply-warp"><div class="reply-list"></div></div>
                    </div>`;
                if(container.parentElement) container.parentElement.innerHTML = newHTML;
                else container.innerHTML = newHTML;
            }
        }

        // 收集 OID (AV/BV/CV ID) 和评论区类型
        async collectEssentialData() {
            const global = unsafeWindow;
            await new Promise(resolve => {
                const timer = setInterval(async () => {
                    const loc = global.location;
                    if (/https:\/\/www\.bilibili\.com\/video\/.*/.test(loc.href)) {
                        const vid = loc.pathname.replace('/video/', '').replace('/', '');
                        if (vid.startsWith('av')) this.oid = vid.slice(2);
                        if (vid.startsWith('BV')) this.oid = this.b2a(vid);
                        this.createrID = global?.__INITIAL_STATE__?.upData?.mid;
                        this.commentType = 1;
                    } else if (/https:\/\/www\.bilibili\.com\/bangumi\/play\/.*/.test(loc.href)) {
                        this.oid = this.b2a(document.querySelector('[class*=mediainfo_mediaDesc] a[href*="video/BV"]')?.textContent);
                        this.createrID = document.querySelector('a[class*=upinfo_upLink]')?.href?.split('/').filter(i=>!!i).pop()||-1;
                        this.commentType = 1;
                    } else if (/https:\/\/t\.bilibili\.com\/\d+/.test(loc.href)) {
                        const dynID = loc.pathname.replace('/', '');
                        const dynDetail = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${dynID}`).then(res => res.json());
                        this.oid = dynDetail?.data?.item?.basic?.comment_id_str;
                        this.commentType = dynDetail?.data?.item?.basic?.comment_type;
                        this.createrID = dynDetail?.data?.item?.modules?.module_author?.mid;
                    } else if (/https:\/\/www\.bilibili\.com\/read\/cv\d+.*/.test(loc.href)) {
                         this.oid = global?.__INITIAL_STATE__?.cvid;
                         this.createrID = global?.__INITIAL_STATE__?.readInfo?.author?.mid;
                         this.commentType = 12;
                    } else if (/https:\/\/space\.bilibili\.com\/.*/.test(loc.href)) {
                         // 空间动态等暂不处理
                    }

                    this.replyList = document.querySelector('.reply-list');
                    if (this.oid && this.commentType && this.replyList) {
                        this.createrID = parseInt(this.createrID);
                        clearInterval(timer);
                        resolve();
                    }
                }, 500);
            });
        }

        // 绑定"最新/最热"切换事件
        async enableSwitchingSortType() {
            const nav = document.querySelector('.comment-container .reply-header .nav-sort');
            if(!nav) return;
            const hot = nav.querySelector('.hot-sort');
            const time = nav.querySelector('.time-sort');
            // 初始化样式
            nav.classList.add('hot'); nav.classList.remove('time');

            hot.addEventListener('click', () => {
                if (this.sortType === 3) return;
                this.sortType = 3;
                nav.classList.add('hot'); nav.classList.remove('time');
                this.loadFirstPagination();
            });
            time.addEventListener('click', () => {
                if (this.sortType === 2) return;
                this.sortType = 2;
                nav.classList.add('time'); nav.classList.remove('hot');
                this.loadFirstPagination();
            });
        }

        // 加载第一页评论
        async loadFirstPagination() {
            this.offsetStore = { 1: `{"offset":""}` };
            // 清空列表
            if(!this.replyList) this.replyList = document.querySelector('.reply-list');
            this.replyList.innerHTML = '<p style="padding: 40px 0; text-align: center; color: #999;">正在加载评论...</p>';
            this.replyPool = {};
            document.querySelector('.no-more-replies-info')?.remove();
            document.querySelector('.page-switcher')?.remove();

            const { data, code } = await this.getPaginationData(1);

            if (code !== 0) {
                this.replyList.innerHTML = `<p style="padding: 100px 0; text-align: center; color: #999;">无法获取评论或评论区已关闭 (Code: ${code})</p>`;
                return;
            }
            this.replyList.innerHTML = ''; // 清除加载提示

            // 更新评论总数
            const countEl = document.querySelector('.comment-container .reply-header .total-reply');
            if(countEl) countEl.textContent = data?.cursor?.all_count || 0;

            // 渲染置顶评论
            if (data.top_replies && data.top_replies.length > 0) {
                this.appendReplyItem(data.top_replies[0], true);
            }

            // 渲染普通评论
            if (!data.replies || data.replies.length === 0) {
                const info = document.createElement('p');
                info.textContent = '没有更多评论';
                info.style = 'padding-bottom: 100px; text-align: center; color: #999;';
                document.querySelector('.comment-container .reply-warp').appendChild(info);
                return;
            }

            data.replies.forEach(r => this.appendReplyItem(r));
            this.addReplyPageSwitcher(); // 添加翻页器
        }

        // 获取评论数据
        async getPaginationData(pageNum) {
            const params = { oid: this.oid, type: this.commentType, mode: this.sortType, wts: parseInt(Date.now() / 1000) };
            params.pagination_str = this.offsetStore[pageNum];
            if (params.pagination_str === 'no-next-offset') return ({ code: 0, data: { replies: [] } });

            const query = await this.getWbiQueryString(params);
            const res = await fetch(`https://api.bilibili.com/x/v2/reply/wbi/main?${query}`).then(r => r.json());
            if (res.code === 0) {
                const next = res.data?.cursor?.pagination_reply?.next_offset;
                this.offsetStore[pageNum + 1] = next ? `{"offset":"${next}"}` : 'no-next-offset';
            }
            return res;
        }

        // Wbi 签名算法 (核心加密逻辑，用于绕过 API 验证)
        // 缓存 nav 数据，避免频繁请求
        async getWbiQueryString(params) {
            // 检查缓存是否存在且未过期（5分钟有效期）
            if (!this._wbiCache || Date.now() - this._wbiCache.time > 5 * 60 * 1000) {
                const nav = await fetch('https://api.bilibili.com/x/web-interface/nav').then(r => r.json());
                const imgKey = nav.data.wbi_img.img_url.slice(nav.data.wbi_img.img_url.lastIndexOf('/') + 1, nav.data.wbi_img.img_url.lastIndexOf('.'));
                const subKey = nav.data.wbi_img.sub_url.slice(nav.data.wbi_img.sub_url.lastIndexOf('/') + 1, nav.data.wbi_img.sub_url.lastIndexOf('.'));
                const mixinKey = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52].map(n=>(imgKey+subKey)[n]).join('').slice(0, 32);
                this._wbiCache = { mixinKey, time: Date.now() };
            }
            const query = Object.keys(params).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key].toString().replace(/[!'()*]/g, ''))}`).join('&');
            return query + '&w_rid=' + SparkMD5.hash(query + this._wbiCache.mixinKey);
        }

        // 构建单条评论 HTML
        appendReplyItem(data, isTop) {
            if (this.replyPool[data.rpid_str]) return;
            const el = document.createElement('div');
            el.classList.add('reply-item');

            // 构造头像挂件 HTML
            const pendantHTML = (CONFIG.settings.enableFanMedal && data.member.pendant.image)
                ? `<div class="bili-avatar-pendent-dom"><img src="${data.member.pendant.image}"></div>`
                : '';

            // 构造粉丝牌 HTML
            const medalHTML = (CONFIG.settings.enableFanMedal && data.member.fans_detail)
                ? `<div class="fan-medal ${data.member.fans_detail.guard_icon?'fan-medal-with-guard-icon':''}"><img class="fan-medal-icon" src="${data.member.fans_detail.guard_icon || 'https://i0.hdslb.com/bfs/live/82d48274d0d84e2c328c4353c38def6eaf5de27a.png'}" style="${!data.member.fans_detail.guard_icon ? 'display:none':''}"><div class="fan-medal-name">${data.member.fans_detail.medal_name}</div><div class="fan-medal-level">${data.member.fans_detail.level}</div></div>`
                : '';

            // 构造图片预览 HTML
            const imagesHTML = data.content.pictures
                ? `<div class="preview-image-container" style="display:flex;margin:8px 0;">${data.content.pictures.map(p=>`<div style="margin-right:4px;cursor:zoom-in"><img src="${p.img_src}" style="border-radius:4px;width:96px;height:96px;object-fit:cover;"></div>`).join('')}</div>`
                : '';

            // 构造笔记前缀
            const notePrefix = (CONFIG.settings.enableNotePrefix && data.content.pictures)
                ? `<div class="note-prefix"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25ZM3.5 6.25a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm.75 2.25h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z"></path></svg> 笔记</div>`
                : '';

            el.innerHTML = `
              <div class="root-reply-container">
                <div class="root-reply-avatar">
                  <div class="avatar">
                    <div class="bili-avatar">
                      <img class="bili-avatar-img" src="${data.member.avatar}">
                      ${pendantHTML}
                    </div>
                  </div>
                </div>
                <div class="content-warp">
                  <div class="user-info">
                    <a class="user-name" target="_blank" href="//space.bilibili.com/${data.member.mid}" style="color: ${data.member.vip.nickname_color || '#61666d'}">${data.member.uname}</a>
                    <span style="height:16px;line-height:16px;padding:0 2px;margin-right:4px;font-size:12px;color:white;border-radius:2px;background-color:${this.getLevelColor(data.member.level_info.current_level)}">LV${data.member.level_info.current_level}</span>
                    ${this.createrID === data.mid ? '<span style="font-size:12px;background:#FF6699;color:white;padding:0 4px;border-radius:2px;margin-right:4px;">UP</span>' : ''}
                    ${medalHTML}
                  </div>
                  <div class="root-reply">
                    <span class="reply-content-container root-reply">
                      <span class="reply-content">${isTop?'<span style="color:#FF6699;margin-right:4px;font-weight:bold;">[置顶]</span>':''}${notePrefix}${this.processContent(data.content.message)}</span>
                    </span>
                    ${imagesHTML}
                    <div class="reply-info">
                      <span class="reply-time" style="margin-right: 20px;">${this.formatTime(data.ctime)}</span>
                      <span class="reply-like">👍 ${data.like}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="sub-reply-container"><div class="sub-reply-list">${this.renderSubReplies(data.replies)}</div></div>
            `;
            this.replyList.appendChild(el);
            this.replyPool[data.rpid_str] = true;
            if (data.content.pictures) new Viewer(el.querySelector('.preview-image-container'), { title: false, toolbar: false });
        }

        // 渲染子评论
        renderSubReplies(replies) {
            if (!replies || !replies.length) return '';
            return replies.map(r => `
                <div class="sub-reply-item">
                    <div class="sub-reply-avatar">
                        <img src="${r.member.avatar}">
                    </div>
                    <div class="sub-reply-content-box">
                        <div style="display:inline-block;margin-bottom:4px;">
                            <a class="sub-user-name" target="_blank" href="//space.bilibili.com/${r.member.mid}" style="color:${r.member.vip.nickname_color||'#61666d'};">${r.member.uname}</a>
                            ${this.createrID === r.mid ? '<span style="font-size:12px;background:#FF6699;color:white;padding:0 2px;border-radius:2px;margin-right:4px;transform:scale(0.85);display:inline-block;">UP</span>' : ''}
                            <span style="font-size:13px;color:#18191C;">${this.processContent(r.content.message)}</span>
                        </div>
                        <div class="sub-reply-info">${this.formatTime(r.ctime)}</div>
                    </div>
                </div>
            `).join('');
        }

        processContent(msg) {
            if (!msg) return '';
            let result = msg.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            result = result.replace(/\[(.*?)\]/g, (match) => `<span style="color:#666;">${match}</span>`);
            return result;
        }

        formatTime(ts) { const d=new Date(ts*1000); return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; }
        getLevelColor(l) { return ['#C0C0C0','#BBBBBB','#8BD29B','#7BCDEF','#FEBB8B','#EE672A','#F04C49'][l] || '#C0C0C0'; }

        // BV号转AV号算法 (Base58)
        b2a(bvid) { const XOR=23442827791579n,MASK=2251799813685247n,BASE=58n,A='FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf',MAP=[0,1,2,9,7,5,6,4,8,3,10,11]; let r=0n; for(let i=3;i<12;i++) r=r*BASE+BigInt(A.indexOf(bvid[MAP[i]])); return `${r&MASK^XOR}`; }

        // 添加分页控件
        addReplyPageSwitcher() {
            let page = 1;
            const container = document.querySelector('.comment-container .reply-warp');
            const switcher = document.createElement('div');
            switcher.className = 'page-switcher';
            switcher.innerHTML = `<div class="page-switcher-wrapper"><span class="page-switcher-prev-btn">上一页</span><span class="page-switcher-current-page">${page}</span><span class="page-switcher-next-btn">下一页</span></div>`;
            container.appendChild(switcher);

            const btnPrev = switcher.querySelector('.page-switcher-prev-btn');
            const btnNext = switcher.querySelector('.page-switcher-next-btn');
            const txtPage = switcher.querySelector('.page-switcher-current-page');

            btnPrev.onclick = () => { if(page>1) { page--; this.loadPage(switcher, page, txtPage); } };
            btnNext.onclick = async () => {
                const nextPage = page + 1;
                const { data } = await this.getPaginationData(nextPage);
                if (data.replies && data.replies.length > 0) {
                    page = nextPage;
                    this.replyList.innerHTML = '';
                    txtPage.textContent = page;
                    data.replies.forEach(r => this.appendReplyItem(r));
                    document.documentElement.scrollTop = document.querySelector('.comment-container').offsetTop - 60;
                } else {
                    Toast.info('没有更多了');
                }
            };
        }

        async loadPage(el, p, txtEl) {
            const { data } = await this.getPaginationData(p);
            if (!data.replies || !data.replies.length) { Toast.info('没有更多了'); return; }
            this.replyList.innerHTML = '';
            txtEl.textContent = p;
            data.replies.forEach(r => this.appendReplyItem(r));
            document.documentElement.scrollTop = document.querySelector('.comment-container').offsetTop - 60;
        }
    }

    // === UI 管理器 (浮动设置面板) ===
    class UIManager {
        constructor(ruleManager, cssInjector) {
            this.ruleManager = ruleManager; this.cssInjector = cssInjector;
            this.root = null; this.shadow = null; this.isOpen = false;
        }
        async init() {
            // 注册菜单命令，以便在图标消失时能强制唤出
            GM_registerMenuCommand("⚡ 强制重置 UI", () => { if(this.root) this.root.remove(); this.renderUI(); Toast.success("UI 已重置"); });
            await Utils.waitForBody();
            if(!document.getElementById('bili-shield-root')) this.renderUI();
            window._biliShieldUpdateStats = () => this.renderStats();
        }

        // 渲染 Shadow DOM UI，隔离页面样式干扰
        renderUI() {
            this.root = document.createElement('div');
            this.root.id = 'bili-shield-root';
            this.root.style.cssText = "position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;";
            document.body.appendChild(this.root);

            this.shadow = this.root.attachShadow({mode: 'open'});
            this.injectStyles(); this.render(); this.bindEvents();
        }

        // 注入面板样式
        injectStyles() {
            this.shadow.innerHTML += `<style>
            :host { --pink:#FF6699; --pink-light:#FFEBF1; --blue:#00AEEC; --orange:#F4A460; --text:#555; --bg:rgba(255,255,255,0.95); }
            * { box-sizing:border-box; font-family:"HarmonyOS Sans","PingFang SC","Microsoft YaHei",sans-serif; }
            /* 悬浮球 */
            .entry-btn { position:fixed; bottom:80px; right:24px; width:56px; height:56px; background:radial-gradient(circle at 30% 30%, #FFD700, #F4A460); border-radius:50%; box-shadow:0 6px 16px rgba(244,164,96,0.4), inset 0 2px 4px rgba(255,255,255,0.5); cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:10000; transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1); animation:float 3s ease-in-out infinite; border:2px solid #FFF; }
            .entry-btn:hover { transform:scale(1.15) rotate(360deg); box-shadow:0 12px 28px rgba(244,164,96,0.6); }
            .entry-btn::after { content:'⚡'; font-size:26px; color:#FFF; text-shadow:0 1px 2px rgba(0,0,0,0.2); }
            @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
            /* 主面板 */
            .panel { position:fixed; bottom:150px; right:24px; width:360px; height:560px; background:var(--bg); backdrop-filter:blur(24px) saturate(180%); border-radius:24px; box-shadow:0 16px 48px rgba(0,0,0,0.15); display:flex; flex-direction:column; opacity:0; pointer-events:none; transform:scale(0.8) translateY(40px); transform-origin:bottom right; transition:all 0.5s cubic-bezier(0.34,1.56,0.64,1); overflow:hidden; border:2px solid #FFF; background-image: radial-gradient(#FF669933 2px, transparent 2px); background-size: 20px 20px; }
            .panel.open { opacity:1; pointer-events:auto; transform:scale(1) translateY(0); }
            .header { padding:16px 24px; background:linear-gradient(135deg, #FF6699 0%, #FF9BB5 100%); color:white; display:flex; justify-content:space-between; align-items:center; box-shadow:0 4px 12px rgba(255,102,153,0.3); z-index:10; }
            .title { font-weight:900; font-size:18px; letter-spacing:1px; display:flex; align-items:center; gap:6px; text-shadow:0 2px 4px rgba(0,0,0,0.1); }
            .badge { font-size:10px; background:#FFF; color:#FF6699; padding:2px 6px; border-radius:10px; font-weight:800; box-shadow:0 2px 4px rgba(0,0,0,0.1); transform:translateY(-1px); }
            .close-btn { cursor:pointer; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:rgba(255,255,255,0.25); transition:0.3s; }
            .close-btn:hover { background:white; color:#FF6699; transform:rotate(90deg); }
            .tabs { display:flex; padding:12px 16px 4px; gap:8px; background:rgba(255,255,255,0.8); z-index:5; }
            .tab { flex:1; padding:8px 0; text-align:center; cursor:pointer; color:#888; font-size:13px; font-weight:700; border-radius:12px; transition:0.3s; background:rgba(0,0,0,0.03); position:relative; overflow:hidden; }
            .tab:hover { background:var(--pink-light); color:var(--pink); }
            .tab.active { background:var(--pink); color:white; box-shadow:0 4px 12px rgba(255,102,153,0.3); transform:translateY(-1px); }
            .content { flex:1; overflow-y:auto; padding:16px; z-index:2; position:relative; }
            .content::-webkit-scrollbar { width:4px; } .content::-webkit-scrollbar-thumb { background:#FFD1E1; border-radius:10px; }
            .view { display:none; animation:fadeIn 0.3s ease-out; position:relative; z-index:2; } .view.active { display:block; }
            /* 统计卡片 */
            .stats-card { background:linear-gradient(135deg,#7FD6F5,#00AEEC); border-radius:16px; padding:20px; color:white; margin-bottom:16px; text-align:center; box-shadow:0 8px 20px rgba(0,174,236,0.3); position:relative; overflow:hidden; transition:transform 0.3s; }
            .stats-card:hover { transform:scale(1.02); }
            .stats-num { font-size:36px; font-weight:900; margin-bottom:4px; text-shadow:0 2px 8px rgba(0,0,0,0.15); letter-spacing:-1px; }
            .stats-label { font-size:13px; font-weight:500; opacity:0.9; background:rgba(0,0,0,0.1); padding:4px 12px; border-radius:20px; display:inline-block; }
            .setting-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.8); padding:14px; margin-bottom:10px; border-radius:14px; box-shadow:0 4px 12px rgba(0,0,0,0.03); transition:all 0.3s; border:1px solid #FFF; backdrop-filter:blur(4px); }
            .setting-item:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(255,102,153,0.1); border-color:var(--pink-light); background:white; }
            .label { font-size:14px; color:#555; font-weight:700; }
            .switch { position:relative; display:inline-block; width:46px; height:26px; }
            .switch input { opacity:0; width:0; height:0; }
            .slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#E0E0E0; transition:.4s cubic-bezier(0.68,-0.55,0.27,1.55); border-radius:30px; }
            .slider:before { position:absolute; content:""; height:20px; width:20px; left:3px; bottom:3px; background-color:white; transition:.4s cubic-bezier(0.68,-0.55,0.27,1.55); border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.2); }
            input:checked + .slider { background-color:var(--orange); }
            input:checked + .slider:before { transform:translateX(20px); }
            .btn { width:100%; padding:12px; background:var(--blue); color:white; border:none; border-radius:12px; cursor:pointer; font-weight:800; font-size:14px; margin-top:10px; transition:0.3s; box-shadow:0 6px 16px rgba(0,174,236,0.25); }
            .btn:hover { filter:brightness(1.1); transform:translateY(-2px); box-shadow:0 10px 24px rgba(0,174,236,0.4); }
            .btn:active { transform:scale(0.96); }
            select { padding:6px 12px; border-radius:10px; border:1px solid #E3E5E7; outline:none; background:#F6F7F8; color:#61666D; font-weight:600; cursor:pointer; }
            .log-box { font-family:"Consolas",monospace; font-size:11px; height:340px; overflow-y:auto; color:#666; padding:10px; line-height:1.6; background:rgba(255,255,255,0.5); border-radius:12px; border:1px solid #EEE; }
            @keyframes fadeIn { from { opacity:0; transform:translateY(15px); } to { opacity:1; transform:translateY(0); } }
            </style>`;
        }

        // 渲染 HTML 结构
        render() {
            const iconClose = `<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:white;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
            this.shadow.innerHTML += `
            <div class="entry-btn" id="toggleBtn" title="超电磁炮准备就绪"></div>
            <div class="panel" id="mainPanel">
                <div class="header"><div class="title">⚡ 全能护盾 <span class="badge">V1.3.1</span></div><div class="close-btn" id="closePanel">${iconClose}</div></div>
                <div class="tabs">
                    <div class="tab active" data-target="home">通用</div><div class="tab" data-target="shield">净化</div>
                    <div class="tab" data-target="unlock">解锁</div><div class="tab" data-target="dev">日志</div>
                </div>
                <div class="content">
                    <div class="view active" id="home">
                        <div class="stats-card"><div class="stats-num" id="keywordCount">...</div><div class="stats-label">御坂网络·规则覆盖中</div></div>
                        <div class="setting-item"><span class="label">🚫 禁止自动弹出登录</span><label class="switch"><input type="checkbox" id="sw_blockLoginPopups"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🌸 经典顶栏</span><label class="switch"><input type="checkbox" id="sw_pinkHeader"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🛠️ 开发者模式</span><label class="switch"><input type="checkbox" id="sw_devMode"><span class="slider"></span></label></div>
                        <button class="btn" id="btnUpdate">立即更新云端词库</button>
                    </div>
                    <div class="view" id="shield">
                        <div class="setting-item"><span class="label">💬 实时弹幕拦截</span><label class="switch"><input type="checkbox" id="sw_filterDanmaku"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">📰 屏蔽新闻资讯</span><label class="switch"><input type="checkbox" id="sw_blockNews"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">⛔ 自动拉黑触犯者</span><label class="switch"><input type="checkbox" id="sw_autoBlockUser"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🎠 隐藏轮播图</span><label class="switch"><input type="checkbox" id="sw_hideCarousel"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">📺 隐藏左侧推广</span><label class="switch"><input type="checkbox" id="sw_hideLeftLocEntry"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🗂️ 隐藏底部卡片</span><label class="switch"><input type="checkbox" id="sw_hideFloorCard"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🧹 推荐流净化</span><label class="switch"><input type="checkbox" id="sw_filterFeed"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🧼 评论区净化</span><label class="switch"><input type="checkbox" id="sw_filterComments"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🛡️ 拦截广告组件</span><label class="switch"><input type="checkbox" id="sw_blockAds"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">😐 屏蔽默认头像</span><label class="switch"><input type="checkbox" id="sw_blockDefaultAvatars"><span class="slider"></span></label></div>
                    </div>
                    <div class="view" id="unlock">
                        <div class="setting-item"><span class="label">📺 解锁 1080P+</span><label class="switch"><input type="checkbox" id="sw_unlockHighQuality"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">⚖️ 防音画不同步</span><label class="switch"><input type="checkbox" id="sw_waitHighQualityLoad"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🎨 偏好画质</span><select id="sel_preferQuality" style="padding:4px 8px;border-radius:8px;border:1px solid #ddd;outline:none;background:#f9f9f9;color:#555;"><option value="1080">1080P</option><option value="720">720P</option><option value="480">480P</option></select></div>
                        <div class="setting-item"><span class="label">👀 未登录看评论</span><label class="switch"><input type="checkbox" id="sw_unlockGuestComments"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🏅 显示粉丝勋章</span><label class="switch"><input type="checkbox" id="sw_enableFanMedal"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">📝 显示笔记前缀</span><label class="switch"><input type="checkbox" id="sw_enableNotePrefix"><span class="slider"></span></label></div>
                    </div>
                    <div class="view" id="dev"><div class="log-box" id="logContainer"></div></div>
                </div>
            </div>`;
            this.renderStats();
        }

        // 绑定事件
        bindEvents() {
            const $ = (s) => this.shadow.querySelector(s);
            const $$ = (s) => this.shadow.querySelectorAll(s);
            $('#toggleBtn').onclick = () => { this.isOpen = !this.isOpen; $('#mainPanel').classList.toggle('open', this.isOpen); };
            $('#closePanel').onclick = () => { this.isOpen = false; $('#mainPanel').classList.remove('open'); };
            // Tab 切换逻辑
            $$('.tab').forEach(t => t.onclick = () => {
                $$('.tab').forEach(x=>x.classList.remove('active')); $$('.view').forEach(x=>x.classList.remove('active'));
                t.classList.add('active'); $(`#${t.dataset.target}`).classList.add('active');
                if(t.dataset.target==='dev') this.renderLogs();
            });
            // 规则更新按钮
            $('#btnUpdate').onclick = () => {
                const btn = $('#btnUpdate'); btn.innerText = "正在连接御坂网络...";
                this.ruleManager.forceUpdate(); setTimeout(() => btn.innerText = "立即更新云端词库", 2000);
            };
            // 自动绑定开关
            const bind = (id, key) => {
                const el = $(`#${id}`);
                if (!el) return;
                if (el.type === 'checkbox') {
                    if (key === 'devMode') {
                        el.checked = STATE.isDevMode;
                        el.onchange = (e) => { STATE.isDevMode = e.target.checked; GM_setValue('cfg_dev_mode', e.target.checked); };
                    } else {
                        el.checked = CONFIG.settings[key];
                        el.onchange = (e) => {
                            CONFIG.settings[key] = e.target.checked;
                            GM_setValue(`cfg_${key}`, e.target.checked);
                            if(['blockAds','pinkHeader','hideFloorCard','blockDefaultAvatars','blockLoginPopups'].includes(key)) this.cssInjector.applyStyles();
                            if(['unlockGuestComments','enableFanMedal','enableNotePrefix'].includes(key)) this.cssInjector.injectUnlockStyles();
                            if (key === 'blockNews') this.ruleManager.parseAndApply(GM_getValue(this.ruleManager.cacheKey, null));
                            if (key === 'unlockHighQuality' && e.target.checked === false) {
                                localStorage.removeItem('bpx_player_profile'); localStorage.removeItem('bilibili_player_codec_prefer_type'); Toast.info('已清除画质锁定缓存');
                            }
                        };
                    }
                } else {
                    el.value = CONFIG.settings[key];
                    el.onchange = (e) => { CONFIG.settings[key] = e.target.value; GM_setValue(`cfg_${key}`, e.target.value); };
                }
            };
            // 批量绑定
            ['pinkHeader','hideCarousel','hideFloorCard','hideLeftLocEntry','filterFeed','filterComments','blockAds','blockDefaultAvatars','devMode',
             'unlockHighQuality','waitHighQualityLoad','unlockGuestComments','enableFanMedal','enableNotePrefix','autoBlockUser','blockNews','blockLoginPopups','filterDanmaku'].forEach(k => bind(`sw_${k}`, k));
            bind('sel_preferQuality', 'preferQuality');
        }

        renderStats() {
            const countEl = this.shadow.querySelector('#keywordCount');
            if(countEl) countEl.innerText = CONFIG.rules.black.strings.size + CONFIG.rules.black.regex.length + CONFIG.rules.white.strings.size + CONFIG.rules.white.regex.length;
        }

        renderLogs() {
            const con = this.shadow.querySelector('#logContainer');
            if(!STATE.isDevMode) { con.innerHTML = '<div style="padding:40px;text-align:center;color:#999">请开启开发者模式<br>(✧ω✧)</div>'; return; }
            con.innerHTML = STATE.logs.slice().reverse().map(l => `<div style="margin-bottom:6px;border-bottom:1px solid #E3E5E7;padding-bottom:4px"><span style="color:#999;font-size:11px">[${l.time}]</span> <b style="color:${l.type==='MISS'||l.type==='RAILGUN'?'#FF6699':'#00AEEC'};margin:0 4px">${l.type}</b> ${l.msg}</div>`).join('');
        }
    }

    // === 主入口 (Main Entry) ===
    function main() {
        Logger.suppressErrors();
        const css = new CSSInjector(); css.init();
        const ruleMgr = new RuleManager(); ruleMgr.init();

        // 安全启动包装器
        const safeInit = (name, fn) => { try { fn(); } catch(e) { Logger.warn(`${name} 启动失败`); } };

        const net = new NetworkInterceptor(ruleMgr); safeInit('网络拦截', () => net.init());
        const cleaner = new SmartCleaner(); safeInit('广告清除', () => cleaner.init());
        const dmCleaner = new DanmakuCleaner(ruleMgr); safeInit('弹幕拦截', () => dmCleaner.init());
        const unlock = new UnlockManager(); safeInit('功能解锁', () => unlock.init());
        const ui = new UIManager(ruleMgr, css); safeInit('UI界面', () => ui.init());

        Logger.info('全能护盾已启动 - Railgun Ultimate');
    }

    main();
})();
