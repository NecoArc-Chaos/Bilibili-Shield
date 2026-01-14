// ==UserScript==
// @name         Bilibili Omnipotent Shield (Bilibili 全能护盾) - Railgun Ultimate
// @namespace    http://tampermonkey.net/
// @version      1.3.0g
// @description  哔哩哔哩全能护盾 - 您贴身的哔哩哔哩API净化大师
// @author       Sakurairinaqwq & DD1969 & Merged
// @match        *://*.bilibili.com/*
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
        logs: [],
        isDevMode: GM_getValue('cfg_dev_mode', false)
    };

    const CONFIG = {
        debug: true,
        // 云端规则订阅源
        remoteBanListUrl: "https://arkn.icu/Bilibili-Shield/%E5%85%A8%E8%83%BD%E6%8A%A4%E7%9B%BE%E5%BA%93/%E8%BF%9D%E7%A6%81%E8%AF%8D/ban.json",
        updateInterval: 24 * 60 * 60 * 1000,

        // 所有功能默认关闭 (Opt-In)，使用 cfg_ 前缀避免旧缓存干扰
        settings: {
            // --- 通用 ---
            blockLoginPopups: GM_getValue('cfg_blockLoginPopups', false), // 禁止登录弹窗

            // --- 护盾 (净化) ---
            blockAds: GM_getValue('cfg_blockAds', false),             // 拦截广告组件
            filterFeed: GM_getValue('cfg_filterFeed', false),         // 过滤推荐流
            filterComments: GM_getValue('cfg_filterComments', false), // 过滤评论区
            filterDanmaku: GM_getValue('cfg_filterDanmaku', false),   // 过滤弹幕
            autoBlockUser: GM_getValue('cfg_autoBlockUser', false),   // 自动拉黑
            blockDefaultAvatars: GM_getValue('cfg_blockDefaultAvatars', false),
            blockNews: GM_getValue('cfg_blockNews', false),           // 屏蔽新闻

            // --- UI (美化) ---
            pinkHeader: GM_getValue('cfg_pinkHeader', false),         // 经典顶栏
            hideCarousel: GM_getValue('cfg_hideCarousel', false),     // 隐藏轮播
            hideFloorCard: GM_getValue('cfg_hideFloorCard', false),   // 隐藏底部
            hideLeftLocEntry: GM_getValue('cfg_hideLeftLocEntry', false), // 隐藏左侧

            // --- 解锁 (增强) ---
            unlockHighQuality: GM_getValue('cfg_unlockHighQuality', false), // 画质解锁
            preferQuality: GM_getValue('cfg_preferQuality', '1080'),
            waitHighQualityLoad: GM_getValue('cfg_waitHighQualityLoad', false),
            unlockGuestComments: GM_getValue('cfg_unlockGuestComments', false), // 评论解锁
            enableFanMedal: GM_getValue('cfg_enableFanMedal', false),
            enableNotePrefix: GM_getValue('cfg_enableNotePrefix', false),
        },

        rules: { black: { strings: new Set(), regex: [] }, white: { strings: new Set(), regex: [] } },
        localKeywords: ["免费教程", "实操变现", "日入", "加我", "v信", "淘宝", "兼职"],
        newsKeywords: ["新闻", "资讯", "日报", "周刊", "快讯", "热点", "头条", "CCTV", "央视", "新华社", "人民日报", "环球网", "观察者网", "凤凰网", "澎湃", "财新", "路透", "BBC", "CNN", "联播", "时政", "民生", "外交部", "白宫", "俄乌", "巴以", "战争", "局势"]
    };

    /**
     * =================================================================
     * 模块：日志系统 (御坂网络风格)
     * =================================================================
     */
    const Logger = {
        push: (type, msg, data = null) => {
            const time = new Date().toLocaleTimeString();
            STATE.logs.push({ time, type, msg, data });
            if (STATE.logs.length > 200) STATE.logs.shift();
            if (window._biliShieldUpdateLogs) window._biliShieldUpdateLogs();
            if (CONFIG.debug && STATE.isDevMode) console.log(`%c[Shield] ${msg}`, 'color:#FF6699', data || '');
        },
        info: (msg) => Logger.push('CONNECT', msg),
        warn: (msg) => Logger.push('WARNING', msg),
        block: (msg) => Logger.push('BLOCK', msg),
        action: (msg) => Logger.push('RAILGUN', msg),
        suppressErrors: () => {
            const originalConsoleError = console.error;
            console.error = function(...args) {
                const str = args.map(a => String(a)).join(' ');
                // 屏蔽 B 站自身的一些渲染报错，保持控制台清爽
                if (str.includes("Cannot read properties of undefined") && str.includes("render")) return;
                originalConsoleError.apply(console, args);
            };
        }
    };

    /**
     * =================================================================
     * 模块：实用工具 (Utils)
     * =================================================================
     */
    const Utils = {
        // 核心修复：智能等待 DOM 元素，防止脚本在 body 创建前运行导致崩溃
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
     * 模块：用户操作执行器 (Action)
     * =================================================================
     */
    class UserActionManager {
        constructor() { this.csrfToken = this.getCsrf(); }
        getCsrf() { const match = document.cookie.match(/bili_jct=([^;]+)/); return match ? match[1] : null; }

        blockUser(mid, username) {
            if (!this.csrfToken) { Logger.warn(`未登录，无法执行正义裁决`); return; }
            // Session 级防抖，避免重复拉黑同一人
            if (sessionStorage.getItem(`shield_blocked_${mid}`)) return;

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
     * 模块：Toast 通知 (Anime Style)
     * =================================================================
     */
    class Toast {
        static async init() {
            if (document.getElementById('bili-shield-toast-container')) return;
            await Utils.waitForBody();
            const container = document.createElement('div');
            container.id = 'bili-shield-toast-container';
            // 右上角悬浮，高层级，点击穿透
            container.style.cssText = "position: fixed; top: 100px; right: 20px; z-index: 2147483647; display: flex; flex-direction: column; gap: 12px; pointer-events: none; align-items: flex-end;";
            document.body.appendChild(container);

            const style = document.createElement('style');
            style.textContent = `
                .bs-toast {
                    background: rgba(255, 255, 255, 0.96);
                    backdrop-filter: blur(16px);
                    padding: 12px 20px;
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0, 174, 236, 0.15); /* 电击蓝阴影 */
                    display: flex; align-items: center; gap: 12px;
                    font-size: 13px; font-weight: bold; color: #444;
                    border: 2px solid #FFF;
                    border-left-width: 5px;
                    opacity: 0; transform: translateX(30px) skewX(-5deg);
                    animation: bsToastIn 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards;
                    pointer-events: auto;
                    min-width: 200px;
                    font-family: "HarmonyOS Sans", "PingFang SC", sans-serif;
                }
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
            setTimeout(() => {
                toast.classList.add('hide');
                toast.addEventListener('animationend', () => toast.remove());
            }, 3000);
        }
        static success(msg) { this.show(msg, 'success'); }
        static error(msg) { this.show(msg, 'error'); }
        static info(msg) { this.show(msg, 'info'); }
    }

    /**
     * =================================================================
     * 模块：规则管理器 (Rule Manager)
     * =================================================================
     */
    class RuleManager {
        constructor() { this.cacheKey = 'bili_shield_rules_v3'; this.lastUpdateKey = 'bili_shield_last_update'; }

        init() {
            this.loadFromCache();
            this.checkUpdate();
        }

        loadFromCache() {
            const rawData = GM_getValue(this.cacheKey, null);
            this.parseAndApply(rawData);
            Logger.info(`词库装载: B[${CONFIG.rules.black.strings.size}] W[${CONFIG.rules.white.strings.size}]`);
        }

        parseAndApply(json) {
            CONFIG.rules = { black: { strings: new Set(), regex: [] }, white: { strings: new Set(), regex: [] } };
            // 注入本地词
            CONFIG.localKeywords.forEach(k => CONFIG.rules.black.strings.add(k));
            // 注入新闻词
            if (CONFIG.settings.blockNews) { CONFIG.newsKeywords.forEach(k => CONFIG.rules.black.strings.add(k)); }

            if (!json) return;

            let blackList = [], whiteList = [];
            if (Array.isArray(json)) blackList = json;
            else if (typeof json === 'object') {
                blackList = json.blacklist || json.ban || json.keywords || [];
                whiteList = json.whitelist || json.white || json.allow || [];
            }

            const process = (arr, target) => {
                if (!Array.isArray(arr)) return;
                arr.forEach(item => {
                    if (typeof item !== 'string' || !item.trim()) return;
                    item = item.trim();
                    if (item.length > 2 && item.startsWith('/') && item.endsWith('/')) {
                        try { target.regex.push(new RegExp(item.slice(1, -1))); } catch (e) { Logger.warn(`无效正则: ${item}`); }
                    } else {
                        target.strings.add(item);
                    }
                });
            };

            process(blackList, CONFIG.rules.black);
            process(whiteList, CONFIG.rules.white);
            if (window._biliShieldUpdateStats) window._biliShieldUpdateStats();
        }

        forceUpdate() { Logger.info('同步云端数据...'); this.fetchRemoteList(true); }
        checkUpdate() { if (Date.now() - GM_getValue(this.lastUpdateKey, 0) > CONFIG.updateInterval) this.fetchRemoteList(); }

        fetchRemoteList(isManual = false) {
            // 强制添加时间戳防缓存
            GM_xmlhttpRequest({
                method: "GET", url: `${CONFIG.remoteBanListUrl}?t=${Date.now()}`, headers: { "Cache-Control": "no-cache" },
                onload: (res) => {
                    if (res.status !== 200) { if(isManual) Toast.error('连接超时'); return; }
                    try {
                        let json = JSON.parse(res.responseText);
                        GM_setValue(this.cacheKey, json); GM_setValue(this.lastUpdateKey, Date.now());
                        this.parseAndApply(json);
                        if(isManual) Toast.success(`规则同步完成！`);
                    } catch (e) {
                        const list = res.responseText.split(/[\r\n,]+/).map(s => s.trim()).filter(s=>s);
                        GM_setValue(this.cacheKey, list); this.parseAndApply(list);
                        if(isManual) Toast.success(`基础规则同步完成`);
                    }
                }
            });
        }

        // 核心验证函数
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

    // === 智能清道夫 (广告/空白占位清除) ===
    class SmartCleaner {
        async init() {
            if (CONFIG.settings.blockAds !== true) return;
            const body = await Utils.waitForBody();
            const observer = new MutationObserver(() => this.cleanGhostCards());
            observer.observe(body, { childList: true, subtree: true });
            setInterval(() => this.cleanGhostCards(), 2500); // 兜底检查
        }
        cleanGhostCards() {
            const feedCards = document.querySelectorAll('.feed-card');
            feedCards.forEach(card => {
                if (card.style.display === 'none') return;
                const videoCard = card.querySelector('.bili-video-card');
                if (videoCard) {
                    const hasInfo = videoCard.querySelector('.bili-video-card__info');
                    const hasSkeleton = videoCard.querySelector('.bili-video-card__skeleton');
                    // 既无信息也无骨架屏 -> 广告占位符
                    if (!hasInfo && !hasSkeleton) card.style.display = 'none';
                }
            });
        }
    }

    // === 弹幕拦截器 (DOM级) ===
    class DanmakuCleaner {
        constructor(ruleManager) { this.ruleManager = ruleManager; }
        async init() {
            if (CONFIG.settings.filterDanmaku !== true) return;
            Logger.info("✅ 弹幕力场展开");
            const body = await Utils.waitForBody();

            const observer = new MutationObserver((mutations) => {
                mutations.forEach(m => m.addedNodes.forEach(node => { if (node.nodeType === 1) this.checkNode(node); }));
            });

            const playerObserver = new MutationObserver(() => {
                // 监听 B 站播放器的弹幕层
                const dmLayer = document.querySelector('.b-danmaku') || document.querySelector('.bilibili-player-video-danmaku');
                if (dmLayer) {
                    observer.observe(dmLayer, { childList: true, subtree: true });
                    // 清理已存在的弹幕
                    dmLayer.querySelectorAll('*').forEach(n => this.checkNode(n));
                }
            });
            playerObserver.observe(body, { childList: true, subtree: true });
        }
        checkNode(node) {
            if (!node.textContent) return;
            if (!this.ruleManager.validate(node.textContent)) {
                node.style.display = 'none'; node.style.visibility = 'hidden'; node.innerHTML = '';
            }
        }
    }

    // === CSS 注入器 ===
    class CSSInjector {
        constructor() { this.styleId = 'bili-shield-global-css'; }
        init() { this.applyStyles(); this.injectUnlockStyles(); }
        applyStyles() {
            let css = '';
            if (CONFIG.settings.blockLoginPopups === true) {
                // 强力隐藏登录遮罩和弹窗
                css += `
                .bili-mini-mask, .login-panel-popover, .bpx-player-toast-login, .vip-login-tip, .mini-login-shim,
                .v-popover-content:has(.login-panel-popover) { display: none !important; pointer-events: none !important; }
                body, html { overflow: auto !important; }
                `;
            }
            if (CONFIG.settings.blockAds === true) {
                // 隐藏广告组件
                css += `
                .adblock-tips, .bili-grid .video-card-common:has(.bili-video-card__info--ad),
                a[href*="cm.bilibili.com"], #slide_ad, .ad-report, .bili-video-card > div[class^="b0"]
                { display: none !important; }
                .feed-card:has(.bili-video-card:not(:has(.bili-video-card__info)):not(:has(.bili-video-card__skeleton)))
                { display: none !important; }
                `;
            }
            if (CONFIG.settings.pinkHeader === true) css += `.bili-header__bar { background-color: #F4A460 !important; } .bili-header .right-entry .right-entry-item { color: #fff !important; }`;
            if (CONFIG.settings.hideCarousel === true) css += `.recommended-swipe { display: none !important; }`;
            if (CONFIG.settings.hideFloorCard === true) css += `.floor-single-card { display: none !important; }`;
            if (CONFIG.settings.hideLeftLocEntry === true) css += `.left-loc-entry, .v-popover-wrap.left-loc-entry { display: none !important; }`;

            let style = document.getElementById(this.styleId);
            if (!style) { style = document.createElement('style'); style.id = this.styleId; document.head.appendChild(style); }
            style.textContent = css;
        }
        injectUnlockStyles() {
            if (CONFIG.settings.unlockGuestComments !== true) return;
            const css = `.bili-avatar-pendent-dom { display: ${CONFIG.settings.enableFanMedal ? 'block' : 'none'} !important; } .note-prefix { display: ${CONFIG.settings.enableNotePrefix ? 'flex' : 'none'} !important; } .reply-item .root-reply-avatar .avatar .bili-avatar { width: 48px; height: 48px; } .sub-reply-item .sub-reply-avatar .avatar .bili-avatar { width: 30px; height: 30px; } .fan-medal { display: flex; align-items: center; height: 14px; margin-left: 5px; border: 0.5px solid rgba(169, 195, 233, 0.18); border-radius: 10px; background-color: rgba(158, 186, 232, 0.2); } .fan-medal-icon { margin-right: -6px; width: 20px; height: 20px; transform: translateX(-3px); } .fan-medal-name { padding-left: 5px; font-size: 9px; color: #577fb8; } .fan-medal-level { width: 12px; height: 12px; border-radius: 50%; font-size: 6px; color: #9ab0d2; background: #fff; text-align: center; line-height: 12px; margin-right: 1px;} .view-more { padding-left: 8px; font-size: 13px; color: #222; cursor: pointer; } .jump-link { color: #008DDA; } .login-tip, .fixed-reply-box, .v-popover:has(.login-panel-popover) { display: none !important; } .page-switcher-wrapper { display: flex; font-size: 14px; color: #666; user-select: none; margin-top: 20px; justify-content: center;} .page-switcher-wrapper span { margin: 0 4px; padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; } .page-switcher-current-page { background: #00A1D6; color: white; border-color: #00A1D6 !important; }`;
            const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
        }
    }

    // === 网络拦截器 ===
    class NetworkInterceptor {
        constructor(ruleManager) {
            this.originalFetch = unsafeWindow.fetch;
            this.originalXHR = unsafeWindow.XMLHttpRequest;
            this.actionManager = new UserActionManager();
            this.ruleManager = ruleManager;
        }
        init() {
            const self = this;
            unsafeWindow.fetch = async function(...args) {
                const url = args[0] instanceof Request ? args[0].url : args[0];
                if (CONFIG.settings.blockAds === true && (url.includes('cm.bilibili.com') || url.includes('data.bilibili.com'))) return new Response(JSON.stringify({code:0,data:{}}));
                const response = await self.originalFetch.apply(this, args);
                if (url.includes('/x/web-interface/wbi/index/top/feed') || url.includes('/reply')) {
                    const clone = response.clone();
                    return self.processResponse(clone, url.includes('reply') ? 'comment' : 'feed');
                }
                return response;
            };
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

        cleanData(type, json) {
            if (!json || !json.data) return json;
            let count = 0;
            if (type === 'feed' && CONFIG.settings.filterFeed === true && json.data.item) {
                const before = json.data.item.length;
                json.data.item = json.data.item.filter(item => {
                    if (['ad','live','game_card'].includes(item.goto)) return false;
                    if (!this.ruleManager.validate(item.title)) { if (item.owner) this.tryBlockUser(item.owner.mid, item.owner.name); return false; }
                    if (CONFIG.settings.blockDefaultAvatars === true && item.owner && /^bili_\d+$/.test(item.owner.name)) return false;
                    return true;
                });
                count = before - json.data.item.length;
            } else if (type === 'comment' && CONFIG.settings.filterComments === true && json.data.replies) {
                const filterReplies = (list) => list ? list.filter(r => {
                    if (!this.ruleManager.validate(r.content.message)) { if (r.member) this.tryBlockUser(r.member.mid, r.member.uname); return false; }
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

    // === 解锁管理器 (主动清理) ===
    class UnlockManager {
        constructor() { this.oid=null; this.type=null; this.replyList=null; this.sort=3; }
        init() {
            if (document.cookie.includes('DedeUserID')) return;

            // 如果功能开启，执行解锁；如果关闭，执行清理！确保 B 站不会自动切 1080P
            if (CONFIG.settings.unlockHighQuality === true) {
                Logger.info("✅ 画质解锁");
                this.unlockQuality();
            } else {
                this.cleanQualityConfig();
            }

            if (CONFIG.settings.unlockGuestComments === true) {
                Logger.info("✅ 评论解锁");
                this.unlockComments();
            }
        }

        cleanQualityConfig() {
            try {
                localStorage.removeItem('bpx_player_profile');
                localStorage.removeItem('bilibili_player_codec_prefer_type');
            } catch(e) {}
        }

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
        unlockComments() {
            setInterval(async ()=>{
                const c = document.querySelector('.comment-container')||document.querySelector('bili-comments');
                if(!c) return;
                if(!c.classList.contains('comment-container')) {
                    c.parentElement.innerHTML = `<div class="comment-container"><div class="reply-header"><div class="reply-navigation"><ul class="nav-bar"><li class="nav-title">评论</li><li class="nav-sort hot">最热</li><li class="nav-sort time">最新</li></ul></div></div><div class="reply-warp"><div class="reply-list"></div></div></div>`;
                    document.querySelector('.hot-sort')?.addEventListener('click',()=>{this.sort=3;this.loadC(1)});
                    document.querySelector('.time-sort')?.addEventListener('click',()=>{this.sort=2;this.loadC(1)});
                }
                if(!this.oid) this.getIds();
                this.replyList = document.querySelector('.reply-list');
                if(this.replyList && !this.replyList.children.length && this.oid) this.loadC(1);
            }, 1000);
        }
        getIds() { const m = location.pathname.match(/BV\w+/); if(m) { this.oid=this.b2a(m[0]); this.type=1; } }
        b2a(bvid) { const XOR=23442827791579n,MASK=2251799813685247n,A='FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf'; let r=0n; for(let i=3;i<bvid.length;i++) r=r*58n+BigInt(A.indexOf(bvid[i])); return `${r&MASK^XOR}`; }
        async loadC(p) {
            if(!this.oid) return;
            const params={oid:this.oid,type:this.type||1,mode:this.sort,plat:1,pn:p,ps:20};
            const nav=await fetch('https://api.bilibili.com/x/web-interface/nav').then(r=>r.json());
            const mixin=this.getMixin(nav.data.wbi_img.img_url.split('/').pop().split('.')[0]+nav.data.wbi_img.sub_url.split('/').pop().split('.')[0]);
            params.wts=Math.round(Date.now()/1000);
            const q=Object.keys(params).sort().map(k=>`${k}=${encodeURIComponent(params[k])}`).join('&');
            GM_xmlhttpRequest({ method:'GET', url:`https://api.bilibili.com/x/v2/reply/wbi/main?${q}&w_rid=${SparkMD5.hash(q+mixin)}`, onload:(r)=>{
                const j=JSON.parse(r.responseText); if(j.code===0) this.render(j.data.replies,p);
            }});
        }
        getMixin(o){return [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52].map(n=>o[n]).join('').slice(0,32)}
        render(l,p) {
            if(p===1) this.replyList.innerHTML='';
            l?.forEach(r=>{
                const d=document.createElement('div'); d.className='reply-item';
                d.innerHTML=`<div style="display:flex;padding:10px 0"><img src="${r.member.avatar}" style="width:40px;height:40px;border-radius:50%;margin-right:10px"><div><div style="font-size:13px;color:#666">${r.member.uname}</div><div style="margin-top:5px">${r.content.message.replace(/</g,'&lt;')}</div></div></div>`;
                this.replyList.appendChild(d);
            });
        }
    }

    // === UI 管理器 (Railgun Pure - Anime) ===
    class UIManager {
        constructor(ruleManager, cssInjector) {
            this.ruleManager = ruleManager; this.cssInjector = cssInjector;
            this.root = null; this.shadow = null; this.isOpen = false;
        }
        async init() {
            // [核心修复] 智能等待 DOM，并注册救援菜单
            GM_registerMenuCommand("⚡ 强制重置 UI", () => {
                if(this.root) this.root.remove();
                this.renderUI();
                Toast.success("UI 已重置");
            });

            await Utils.waitForBody();
            if(!document.getElementById('bili-shield-root')) this.renderUI();
            window._biliShieldUpdateStats = () => this.renderStats();
        }
        renderUI() {
            this.root = document.createElement('div');
            this.root.id = 'bili-shield-root';
            this.root.style.cssText = "position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;";
            document.body.appendChild(this.root);

            this.shadow = this.root.attachShadow({mode: 'open'});
            this.injectStyles(); this.render(); this.bindEvents();
        }
        injectStyles() {
            this.shadow.innerHTML += `<style>
            :host { --pink:#FF6699; --pink-light:#FFEBF1; --blue:#00AEEC; --orange:#F4A460; --text:#555; --bg:rgba(255,255,255,0.95); }
            * { box-sizing:border-box; font-family:"HarmonyOS Sans","PingFang SC","Microsoft YaHei",sans-serif; }

            /* 超电磁炮硬币 (Base64 SVG) */
            .entry-btn { position:fixed; bottom:80px; right:24px; width:56px; height:56px; background:radial-gradient(circle at 30% 30%, #FFD700, #F4A460); border-radius:50%; box-shadow:0 6px 16px rgba(244,164,96,0.4), inset 0 2px 4px rgba(255,255,255,0.5); cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:10000; transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1); animation:float 3s ease-in-out infinite; border:2px solid #FFF; }
            .entry-btn:hover { transform:scale(1.15) rotate(360deg); box-shadow:0 12px 28px rgba(244,164,96,0.6); }
            .entry-btn::after { content:'⚡'; font-size:26px; color:#FFF; text-shadow:0 1px 2px rgba(0,0,0,0.2); }
            @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }

            /* 面板 (Q弹展开) */
            .panel { position:fixed; bottom:150px; right:24px; width:360px; height:560px; background:var(--bg); backdrop-filter:blur(24px) saturate(180%); border-radius:24px; box-shadow:0 16px 48px rgba(0,0,0,0.15); display:flex; flex-direction:column; opacity:0; pointer-events:none; transform:scale(0.8) translateY(40px); transform-origin:bottom right; transition:all 0.5s cubic-bezier(0.34,1.56,0.64,1); overflow:hidden; border:2px solid #FFF;
            background-image: radial-gradient(#FF669933 2px, transparent 2px); background-size: 20px 20px; }
            .panel.open { opacity:1; pointer-events:auto; transform:scale(1) translateY(0); }

            /* 标题栏 */
            .header { padding:16px 24px; background:linear-gradient(135deg, #FF6699 0%, #FF9BB5 100%); color:white; display:flex; justify-content:space-between; align-items:center; box-shadow:0 4px 12px rgba(255,102,153,0.3); z-index:10; }
            .title { font-weight:900; font-size:18px; letter-spacing:1px; display:flex; align-items:center; gap:6px; text-shadow:0 2px 4px rgba(0,0,0,0.1); }
            .badge { font-size:10px; background:#FFF; color:#FF6699; padding:2px 6px; border-radius:10px; font-weight:800; box-shadow:0 2px 4px rgba(0,0,0,0.1); transform:translateY(-1px); }
            .close-btn { cursor:pointer; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:rgba(255,255,255,0.25); transition:0.3s; }
            .close-btn:hover { background:white; color:#FF6699; transform:rotate(90deg); }

            /* 内容区 */
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

            /* 设置项 */
            .setting-item { display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.8); padding:14px; margin-bottom:10px; border-radius:14px; box-shadow:0 4px 12px rgba(0,0,0,0.03); transition:all 0.3s; border:1px solid #FFF; backdrop-filter:blur(4px); }
            .setting-item:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(255,102,153,0.1); border-color:var(--pink-light); background:white; }
            .label { font-size:14px; color:#555; font-weight:700; }

            /* 药丸开关 (Railgun Style) */
            .switch { position:relative; display:inline-block; width:46px; height:26px; }
            .switch input { opacity:0; width:0; height:0; }
            .slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#E0E0E0; transition:.4s cubic-bezier(0.68,-0.55,0.27,1.55); border-radius:30px; }
            .slider:before { position:absolute; content:""; height:20px; width:20px; left:3px; bottom:3px; background-color:white; transition:.4s cubic-bezier(0.68,-0.55,0.27,1.55); border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.2); }
            input:checked + .slider { background-color:var(--orange); } /* Railgun Orange */
            input:checked + .slider:before { transform:translateX(20px); }

            .btn { width:100%; padding:12px; background:var(--blue); color:white; border:none; border-radius:12px; cursor:pointer; font-weight:800; font-size:14px; margin-top:10px; transition:0.3s; box-shadow:0 6px 16px rgba(0,174,236,0.25); }
            .btn:hover { filter:brightness(1.1); transform:translateY(-2px); box-shadow:0 10px 24px rgba(0,174,236,0.4); }
            .btn:active { transform:scale(0.96); }

            select { padding:6px 12px; border-radius:10px; border:1px solid #E3E5E7; outline:none; background:#F6F7F8; color:#61666D; font-weight:600; cursor:pointer; }
            .log-box { font-family:"Consolas",monospace; font-size:11px; height:340px; overflow-y:auto; color:#666; padding:10px; line-height:1.6; background:rgba(255,255,255,0.5); border-radius:12px; border:1px solid #EEE; }
            @keyframes fadeIn { from { opacity:0; transform:translateY(15px); } to { opacity:1; transform:translateY(0); } }
            </style>`;
        }
        render() {
            const iconClose = `<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:white;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
            this.shadow.innerHTML += `
            <div class="entry-btn" id="toggleBtn" title="超电磁炮准备就绪"></div>
            <div class="panel" id="mainPanel">
                <div class="header">
                    <div class="title">⚡ 全能护盾 <span class="badge">V1.3.0g</span></div>
                    <div class="close-btn" id="closePanel">${iconClose}</div>
                </div>
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
        bindEvents() {
            const $ = (s) => this.shadow.querySelector(s);
            const $$ = (s) => this.shadow.querySelectorAll(s);
            $('#toggleBtn').onclick = () => {
                this.isOpen = !this.isOpen;
                $('#mainPanel').classList.toggle('open', this.isOpen);
            };
            $('#closePanel').onclick = () => {
                this.isOpen = false;
                $('#mainPanel').classList.remove('open');
            };
            $$('.tab').forEach(t => t.onclick = () => {
                $$('.tab').forEach(x=>x.classList.remove('active')); $$('.view').forEach(x=>x.classList.remove('active'));
                t.classList.add('active'); $(`#${t.dataset.target}`).classList.add('active');
                if(t.dataset.target==='dev') this.renderLogs();
            });
            $('#btnUpdate').onclick = () => {
                const btn = $('#btnUpdate');
                btn.innerText = "正在连接御坂网络...";
                this.ruleManager.forceUpdate();
                setTimeout(() => btn.innerText = "立即更新云端词库", 2000);
            };
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
                                localStorage.removeItem('bpx_player_profile');
                                localStorage.removeItem('bilibili_player_codec_prefer_type');
                                Toast.info('已清除画质锁定缓存');
                            }
                        };
                    }
                } else {
                    el.value = CONFIG.settings[key];
                    el.onchange = (e) => { CONFIG.settings[key] = e.target.value; GM_setValue(`cfg_${key}`, e.target.value); };
                }
            };
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

    // === 主入口 ===
    function main() {
        Logger.suppressErrors();

        const css = new CSSInjector(); css.init();
        const ruleMgr = new RuleManager(); ruleMgr.init();

        const safeInit = (name, fn) => { try { fn(); } catch(e) { Logger.warn(`${name} 启动失败`); } };

        const net = new NetworkInterceptor(ruleMgr);
        safeInit('网络拦截', () => net.init());

        const cleaner = new SmartCleaner();
        safeInit('广告清除', () => cleaner.init());

        const dmCleaner = new DanmakuCleaner(ruleMgr);
        safeInit('弹幕拦截', () => dmCleaner.init());

        const unlock = new UnlockManager();
        safeInit('功能解锁', () => unlock.init());

        const ui = new UIManager(ruleMgr, css);
        safeInit('UI界面', () => ui.init());

        Logger.info('全能护盾已启动 - Railgun Pure');
    }

    main();
})();
