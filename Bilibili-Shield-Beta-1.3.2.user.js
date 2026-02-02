// ==UserScript==
// @name         Bilibili Omnipotent Shield (Bilibili 全能护盾) - Railgun Ultimate (Refactored & DevMode Enhanced)
// @namespace    http://tampermonkey.net/
// @version      1.3.2-DevEnhanced
// @description  哔哩哔哩全能护盾 - 完美修复未登录查看评论功能 & 极致净化体验 (开发者模式支持红框高亮敏感词)
// @author       Sakurairinaqwq & DD1969 & Refactored
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
     * ============================================================
     * 模块名称：Constants & Types
     * 模块功能：全局常量定义
     * ============================================================
     */
    const CONSTANTS = {
        REMOTE_BAN_LIST_URL: "https://arkn.icu/Bilibili-Shield/%E5%85%A8%E8%83%BD%E6%8A%A4%E7%9B%BE%E5%BA%93/%E8%BF%9D%E7%A6%81%E8%AF%8D/ban.json",
        UPDATE_INTERVAL: 24 * 60 * 60 * 1000,
        CACHE_KEYS: {
            RULES: 'bili_shield_rules_v3',
            LAST_UPDATE: 'bili_shield_last_update',
            DEV_MODE: 'cfg_dev_mode'
        },
        DEFAULT_KEYWORDS: ["免费教程", "实操变现", "日入", "加我", "v信", "淘宝", "兼职"],
        NEWS_KEYWORDS: ["新闻", "资讯", "日报", "周刊", "快讯", "热点", "头条", "CCTV", "央视", "新华社", "人民日报", "环球网", "观察者网", "凤凰网", "澎湃", "财新", "路透", "BBC", "CNN", "联播", "时政", "民生", "外交部", "白宫", "俄乌", "巴以", "战争", "局势"]
    };

    /**
     * ============================================================
     * 模块名称：LogManager
     * 模块功能：统一日志管理与调试
     * ============================================================
     */
    class LogManager {
        constructor() {
            this.logs = [];
            this.maxLogs = 200;
            this.isDevMode = GM_getValue(CONSTANTS.CACHE_KEYS.DEV_MODE, false);
            this.listeners = new Set();
            this.suppressNativeErrors();
        }

        static getInstance() {
            if (!LogManager.instance) LogManager.instance = new LogManager();
            return LogManager.instance;
        }

        subscribe(callback) {
            this.listeners.add(callback);
        }

        push(type, msg, data = null) {
            const time = new Date().toLocaleTimeString();
            const logEntry = { time, type, msg, data };
            this.logs.push(logEntry);
            if (this.logs.length > this.maxLogs) this.logs.shift();

            // 通知 UI 更新
            this.listeners.forEach(cb => cb());

            if (this.isDevMode) {
                const style = type === 'BLOCK' || type === 'WARNING' ? 'color:#FF6699' : 'color:#00AEEC';
                console.log(`%c[Shield][${type}] ${msg}`, style, data || '');
            }
        }

        info(msg) { this.push('CONNECT', msg); }
        warn(msg) { this.push('WARNING', msg); }
        error(msg) { this.push('ERROR', msg); }
        block(msg) { this.push('BLOCK', msg); }
        action(msg) { this.push('RAILGUN', msg); }

        suppressNativeErrors() {
            const originalConsoleError = console.error;
            console.error = function(...args) {
                const str = args.map(a => String(a)).join(' ');
                if (str.includes("Cannot read properties of undefined") && str.includes("render")) return;
                originalConsoleError.apply(console, args);
            };
        }
    }

    /**
     * ============================================================
     * 模块名称：ConfigManager
     * 模块功能：配置管理（单例），处理本地存储
     * ============================================================
     */
    class ConfigManager {
        constructor() {
            this.settings = {
                blockLoginPopups: false,
                blockAds: false,
                filterFeed: false,
                filterComments: false,
                filterDanmaku: false,
                autoBlockUser: false,
                blockDefaultAvatars: false,
                blockNews: false,
                pinkHeader: false,
                hideCarousel: false,
                hideFloorCard: false,
                hideLeftLocEntry: false,
                unlockHighQuality: false,
                preferQuality: '1080',
                waitHighQualityLoad: false,
                unlockGuestComments: false,
                enableFanMedal: true,
                enableNotePrefix: true,
                // DevMode 由 LogManager 和全局 Key 控制，但也在这里保留引用以便统一读取
                devMode: GM_getValue(CONSTANTS.CACHE_KEYS.DEV_MODE, false)
            };
            this.loadSettings();
        }

        static getInstance() {
            if (!ConfigManager.instance) ConfigManager.instance = new ConfigManager();
            return ConfigManager.instance;
        }

        loadSettings() {
            Object.keys(this.settings).forEach(key => {
                if(key !== 'devMode') this.settings[key] = GM_getValue(`cfg_${key}`, this.settings[key]);
            });
        }

        set(key, value) {
            if (key in this.settings || key === 'devMode') {
                this.settings[key] = value;
                if(key === 'devMode') GM_setValue(CONSTANTS.CACHE_KEYS.DEV_MODE, value);
                else GM_setValue(`cfg_${key}`, value);
            }
        }

        get(key) {
            if(key === 'devMode') return GM_getValue(CONSTANTS.CACHE_KEYS.DEV_MODE, false);
            return this.settings[key];
        }
    }

    /**
     * ============================================================
     * 模块名称：DOMUtils
     * 模块功能：DOM 操作辅助
     * ============================================================
     */
    const DOMUtils = {
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
        },
        createStyle: (css, id) => {
            const style = document.createElement('style');
            if (id) style.id = id;
            style.textContent = css;
            return style;
        }
    };

    /**
     * ============================================================
     * 模块名称：Toast
     * 模块功能：全局提示框
     * ============================================================
     */
    class Toast {
        static async init() {
            if (document.getElementById('bili-shield-toast-container')) return;
            await DOMUtils.waitForBody();
            const container = document.createElement('div');
            container.id = 'bili-shield-toast-container';
            container.style.cssText = "position: fixed; top: 100px; right: 20px; z-index: 2147483647; display: flex; flex-direction: column; gap: 12px; pointer-events: none; align-items: flex-end;";
            document.body.appendChild(container);

            const style = DOMUtils.createStyle(`
                .bs-toast { background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(16px); padding: 12px 20px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0, 174, 236, 0.15); display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: bold; color: #444; border: 2px solid #FFF; border-left-width: 5px; opacity: 0; transform: translateX(30px) skewX(-5deg); animation: bsToastIn 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards; pointer-events: auto; min-width: 200px; font-family: "HarmonyOS Sans", "PingFang SC", sans-serif; }
                .bs-toast.hide { animation: bsToastOut 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards !important; }
                .bs-toast.success { border-left-color: #00AEEC; background: linear-gradient(to right, #F0FAFF, #FFF); }
                .bs-toast.error { border-left-color: #FF6699; background: linear-gradient(to right, #FFF0F5, #FFF); }
                .bs-toast.info { border-left-color: #F4A460; background: linear-gradient(to right, #FFF8F0, #FFF); }
                @keyframes bsToastIn { to { opacity: 1; transform: translateX(0) skewX(0); } }
                @keyframes bsToastOut { to { opacity: 0; transform: translateX(30px) scale(0.9); } }
            `);
            document.head.appendChild(style);
        }

        static async show(message, type = 'info') {
            await this.init();
            const container = document.getElementById('bili-shield-toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = `bs-toast ${type}`;
            const icon = type === 'success' ? '✨' : (type === 'error' ? '💥' : '⚡');
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
     * ============================================================
     * 模块名称：RuleManager
     * 模块功能：关键词/正则规则管理与同步
     * ============================================================
     */
    class RuleManager {
        constructor() {
            this.config = ConfigManager.getInstance();
            this.logger = LogManager.getInstance();
            this.rules = { black: { strings: new Set(), regex: [] }, white: { strings: new Set(), regex: [] } };
            this.init();
        }

        init() {
            const cached = GM_getValue(CONSTANTS.CACHE_KEYS.RULES, null);
            this.parseAndApply(cached);
            this.checkUpdate();
        }

        parseAndApply(json) {
            this.rules = { black: { strings: new Set(), regex: [] }, white: { strings: new Set(), regex: [] } };
            CONSTANTS.DEFAULT_KEYWORDS.forEach(k => this.rules.black.strings.add(k));
            if (this.config.get('blockNews')) {
                CONSTANTS.NEWS_KEYWORDS.forEach(k => this.rules.black.strings.add(k));
            }

            if (!json) return;

            let blackList = [], whiteList = [];
            if (Array.isArray(json)) {
                blackList = json;
            } else if (typeof json === 'object') {
                blackList = json.blacklist || json.ban || json.keywords || [];
                whiteList = json.whitelist || json.white || json.allow || [];
            }

            const processList = (arr, target) => {
                if (!Array.isArray(arr)) return;
                arr.forEach(item => {
                    if (typeof item !== 'string' || !item.trim()) return;
                    item = item.trim();
                    if (item.length > 2 && item.startsWith('/') && item.endsWith('/')) {
                        try {
                            target.regex.push(new RegExp(item.slice(1, -1)));
                        } catch (e) {
                            this.logger.warn(`无效正则: ${item}`);
                        }
                    } else {
                        target.strings.add(item);
                    }
                });
            };

            processList(blackList, this.rules.black);
            processList(whiteList, this.rules.white);
            this.logger.info(`词库装载: 黑名单[${this.rules.black.strings.size}] 白名单[${this.rules.white.strings.size}]`);
        }

        checkUpdate() {
            const lastUpdate = GM_getValue(CONSTANTS.CACHE_KEYS.LAST_UPDATE, 0);
            if (Date.now() - lastUpdate > CONSTANTS.UPDATE_INTERVAL) {
                this.fetchRemoteList();
            }
        }

        forceUpdate() {
            this.logger.info('同步云端数据...');
            this.fetchRemoteList(true);
        }

        fetchRemoteList(isManual = false) {
            GM_xmlhttpRequest({
                method: "GET",
                url: `${CONSTANTS.REMOTE_BAN_LIST_URL}?t=${Date.now()}`,
                headers: { "Cache-Control": "no-cache" },
                onload: (res) => {
                    if (res.status !== 200) {
                        if (isManual) Toast.error('连接超时');
                        return;
                    }
                    try {
                        let json = JSON.parse(res.responseText);
                        GM_setValue(CONSTANTS.CACHE_KEYS.RULES, json);
                        GM_setValue(CONSTANTS.CACHE_KEYS.LAST_UPDATE, Date.now());
                        this.parseAndApply(json);
                        if (isManual) Toast.success('规则同步完成！');
                    } catch (e) {
                        const list = res.responseText.split(/[\r\n,]+/).map(s => s.trim()).filter(s => s);
                        GM_setValue(CONSTANTS.CACHE_KEYS.RULES, list);
                        this.parseAndApply(list);
                        if (isManual) Toast.success('基础规则同步完成');
                    }
                }
            });
        }

        // 返回详细匹配信息
        check(txt) {
            if (!txt) return { blocked: false, keyword: null };
            
            // 白名单检查
            if (this.rules.white.strings.has(txt)) return { blocked: false, keyword: null };
            for (let s of this.rules.white.strings) if (txt.includes(s)) return { blocked: false, keyword: null };
            for (let r of this.rules.white.regex) if (r.test(txt)) return { blocked: false, keyword: null };
            
            // 黑名单检查
            for (let s of this.rules.black.strings) if (txt.includes(s)) return { blocked: true, keyword: s };
            for (let r of this.rules.black.regex) {
                const match = r.exec(txt);
                if (match) return { blocked: true, keyword: r };
            }
            
            return { blocked: false, keyword: null };
        }

        // 兼容旧 API
        validate(txt) {
            return !this.check(txt).blocked;
        }

        getStats() {
            return this.rules.black.strings.size + this.rules.black.regex.length +
                   this.rules.white.strings.size + this.rules.white.regex.length;
        }
    }

    /**
     * ============================================================
     * 模块名称：ActionManager
     * 模块功能：API操作封装（拉黑用户）
     * ============================================================
     */
    class ActionManager {
        constructor() {
            this.logger = LogManager.getInstance();
            this.csrfToken = this.getCsrf();
        }

        getCsrf() {
            const match = document.cookie.match(/bili_jct=([^;]+)/);
            return match ? match[1] : null;
        }

        blockUser(mid, username) {
            if (!this.csrfToken) return;
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
                            this.logger.action(`自动拉黑: ${username}`);
                            Toast.success(`⚡ 已将 ${username} 移入黑名单`);
                            sessionStorage.setItem(`shield_blocked_${mid}`, '1');
                        }
                    } catch (e) {}
                }
            });
        }
    }

    /**
     * ============================================================
     * 模块名称：StyleManager
     * 模块功能：CSS 样式注入与管理
     * ============================================================
     */
    class StyleManager {
        constructor() {
            this.styleId = 'bili-shield-global-css';
            this.config = ConfigManager.getInstance();
        }

        refresh() {
            const css = this.buildCSS();
            let style = document.getElementById(this.styleId);
            if (!style) {
                style = document.createElement('style');
                style.id = this.styleId;
                document.head.appendChild(style);
            }
            style.textContent = css;
            this.injectUnlockStyles();
        }

        buildCSS() {
            let css = '';
            if (this.config.get('blockLoginPopups')) {
                css += `.bili-mini-mask, .login-panel-popover, .bpx-player-toast-login, .vip-login-tip, .mini-login-shim, .v-popover-content:has(.login-panel-popover) { display: none !important; pointer-events: none !important; } body, html { overflow: auto !important; }`;
            }
            if (this.config.get('blockAds')) {
                css += `.adblock-tips, .bili-grid .video-card-common:has(.bili-video-card__info--ad), a[href*="cm.bilibili.com"], #slide_ad, .ad-report, .bili-video-card > div[class^="b0"] { display: none !important; } .feed-card:has(.bili-video-card:not(:has(.bili-video-card__info)):not(:has(.bili-video-card__skeleton))) { display: none !important; }`;
            }
            if (this.config.get('pinkHeader')) {
                css += `.bili-header__bar { background-color: #F4A460 !important; } .bili-header .right-entry .right-entry-item { color: #fff !important; }`;
            }
            if (this.config.get('hideCarousel')) css += `.recommended-swipe { display: none !important; }`;
            if (this.config.get('hideFloorCard')) css += `.floor-single-card { display: none !important; }`;
            if (this.config.get('hideLeftLocEntry')) css += `.left-loc-entry, .v-popover-wrap.left-loc-entry { display: none !important; }`;
            return css;
        }

        injectUnlockStyles() {
            if (!this.config.get('unlockGuestComments')) return;
            const css = `
                /* 评论解锁相关样式省略，保持原样 */
                .comment-container .reply-header { margin-bottom: 24px; }
                .comment-container .nav-bar { display: flex; align-items: center; padding: 0; margin: 0; list-style: none; }
                .comment-container .nav-title { display: flex; align-items: center; font-size: 20px; font-weight: 500; color: #18191C; }
                .comment-container .total-reply { margin-left: 6px; font-size: 14px; color: #9499A0; font-weight: 400; }
                .comment-container .nav-sort { display: flex; align-items: center; margin-left: 40px; color: #9499A0; font-size: 14px; user-select: none; }
                .comment-container .nav-sort > div { cursor: pointer; transition: color 0.2s; }
                .comment-container .nav-sort > div:hover { color: #00AEEC; }
                .comment-container .nav-sort .part-symbol { height: 11px; border-left: 1px solid #9499A0; margin: 0 12px; opacity: 0.5; }
                .comment-container .nav-sort.hot .hot-sort { color: #18191C; font-weight: 500; cursor: default; }
                .comment-container .nav-sort.time .time-sort { color: #18191C; font-weight: 500; cursor: default; }
                .reply-item { padding: 22px 0 14px 0; border-bottom: 1px solid #E3E5E7; }
                .reply-item .root-reply-container { display: flex; padding-left: 0; }
                .reply-item .root-reply-avatar { margin-right: 16px; position: relative; width: 48px; min-width: 48px; }
                .reply-item .root-reply-avatar .avatar { position: relative; width: 48px; height: 48px; }
                .reply-item .root-reply-avatar .avatar .bili-avatar { width: 48px; height: 48px; border-radius: 50%; border: 1px solid #F1F2F3; position: relative; }
                .reply-item .root-reply-avatar .bili-avatar-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
                .bili-avatar-pendent-dom { position: absolute; top: -17%; left: -17%; width: 135%; height: 135%; pointer-events: none; z-index: 1; }
                .reply-item .content-warp { flex: 1; position: relative; }
                .reply-item .user-info { display: flex; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
                .reply-item .user-name { font-size: 13px; font-weight: 500; margin-right: 5px; color: #61666d; cursor: pointer; text-decoration: none; }
                .reply-item .user-name:hover { color: #00AEEC; }
                .reply-item .reply-content { font-size: 15px; line-height: 24px; color: #18191C; overflow: hidden; word-wrap: break-word; white-space: pre-wrap; display: block; }
                .reply-item .reply-info { display: flex; align-items: center; color: #9499A0; font-size: 13px; margin-top: 4px; }
                .reply-item .reply-like { margin-right: 18px; display: flex; align-items: center; }
                .sub-reply-container { padding-left: 64px; margin-top: 10px; }
                .sub-reply-item { display: flex; padding: 8px 0; align-items: flex-start; }
                .sub-reply-item .sub-reply-avatar { margin-right: 10px; width: 24px; min-width: 24px; height: 24px; }
                .sub-reply-item .sub-reply-avatar img { width: 100%; height: 100%; border-radius: 50%; border: 1px solid #F1F2F3; }
                .sub-reply-content-box { flex: 1; font-size: 13px; line-height: 20px; }
                .sub-user-name { font-weight: 500; margin-right: 5px; cursor: pointer; color: #61666d; text-decoration: none; }
                .sub-user-name:hover { color: #00AEEC; }
                .sub-reply-info { font-size: 12px; color: #999; margin-top: 2px; }
                .fan-medal { display: inline-flex; align-items: center; height: 14px; margin-left: 2px; margin-right: 4px; border: 0.5px solid rgba(169, 195, 233, 0.18); border-radius: 10px; background-color: rgba(158, 186, 232, 0.2); vertical-align: middle; cursor: pointer; padding-right: 4px; }
                .fan-medal.fan-medal-with-guard-icon { border-color: #8da8e8; background-color: #b4ccff; }
                .fan-medal-icon { margin-right: -6px; width: 20px; height: 20px; overflow: clip; transform: translateX(-3px); object-fit: cover; }
                .fan-medal-name { margin-right: 2px; padding-left: 5px; line-height: 14px; white-space: nowrap; font-size: 9px; color: #577fb8; }
                .fan-medal-with-guard-icon > .fan-medal-name { color: #385599; }
                .fan-medal-level { display: flex; justify-content: center; align-items: center; margin-right: 0.5px; width: 12px; height: 12px; border-radius: 50%; line-height: 1; white-space: nowrap; font-family: sans-serif; font-size: 8px; transform: scale(0.85); color: #9ab0d2; background-color: #ffffff; }
                .fan-medal-with-guard-icon > .fan-medal-level { color: #5e80c4; }
                .page-switcher { display: flex; justify-content: center; margin: 30px 0; }
                .page-switcher-wrapper { display: flex; font-size: 14px; color: #666; user-select: none; align-items: center; }
                .page-switcher-wrapper span { margin: 0 4px; }
                .page-switcher-wrapper span:not(.page-switcher-current-page) { padding: 8px 16px; border: 1px solid #D7DDE4; border-radius: 4px; cursor: pointer; transition: 0.2s; background: #FFF; }
                .page-switcher-prev-btn:hover, .page-switcher-next-btn:hover { border-color: #00A1D6 !important; color: #00A1D6; }
                .page-switcher-current-page { color: white; background-color: #00A1D6; padding: 8px 16px; border-radius: 4px; cursor: default; }
                .jump-link { color: #008DDA; text-decoration: none; }
                .jump-link:hover { text-decoration: underline; }
                .note-prefix { display: inline-flex; align-items: center; color: #999; font-size: 12px; margin-right: 4px; vertical-align: middle; }
                .login-tip, .fixed-reply-box, .v-popover:has(.login-panel-popover) { display: none !important; }
                @media screen and (max-width: 1620px) {
                    .reply-item .root-reply-avatar { width: 40px; min-width: 40px; }
                    .reply-item .root-reply-avatar .avatar, .reply-item .root-reply-avatar .avatar .bili-avatar { width: 40px; height: 40px; }
                }
            `;
            if (!document.getElementById('bili-shield-unlock-css')) {
                document.head.appendChild(DOMUtils.createStyle(css, 'bili-shield-unlock-css'));
            }
        }
    }

    /**
     * ============================================================
     * 模块名称：NetworkProxy
     * 模块功能：劫持 Fetch/XHR，进行数据清洗
     * ============================================================
     */
    class NetworkProxy {
        constructor(ruleManager) {
            this.ruleManager = ruleManager;
            this.config = ConfigManager.getInstance();
            this.logger = LogManager.getInstance();
            this.actionManager = new ActionManager();
            this.originalFetch = unsafeWindow.fetch;
            this.originalXHR = unsafeWindow.XMLHttpRequest;
        }

        enable() {
            const self = this;

            // Fetch Hijack
            unsafeWindow.fetch = async function(...args) {
                const url = args[0] instanceof Request ? args[0].url : args[0];

                if (self.config.get('blockAds') && (url.includes('cm.bilibili.com') || url.includes('data.bilibili.com'))) {
                    return new Response(JSON.stringify({ code: 0, data: {} }));
                }

                const response = await self.originalFetch.apply(this, args);

                if (url.includes('/x/web-interface/wbi/index/top/feed') || url.includes('/reply')) {
                    const clone = response.clone();
                    return self.processResponse(clone, url.includes('reply') ? 'comment' : 'feed').catch(() => response);
                }
                return response;
            };

            // XHR Hijack
            unsafeWindow.XMLHttpRequest = class extends self.originalXHR {
                open(method, url) {
                    this._url = url;
                    super.open(method, url);
                }
                send(body) {
                    const originalReady = this.onreadystatechange;
                    this.onreadystatechange = function() {
                        if (this.readyState === 4 && this.status === 200 && self.isTarget(this._url)) {
                            try {
                                const data = JSON.parse(this.responseText);
                                const clean = self.cleanData(this._url.includes('reply') ? 'comment' : 'feed', data);
                                Object.defineProperty(this, 'responseText', { value: JSON.stringify(clean) });
                                Object.defineProperty(this, 'response', { value: JSON.stringify(clean) });
                            } catch (e) {}
                        }
                        if (originalReady) originalReady.apply(this, arguments);
                    };
                    super.send(body);
                }
            };
        }

        isTarget(url) {
            return (url && (url.includes('/reply') || url.includes('/feed/rcmd')));
        }

        async processResponse(res, type) {
            try {
                const data = await res.json();
                return new Response(JSON.stringify(this.cleanData(type, data)), { status: res.status, headers: res.headers });
            } catch (e) {
                return res;
            }
        }

        tryBlockUser(mid, name) {
            if (this.config.get('autoBlockUser') && mid) {
                this.actionManager.blockUser(mid, name);
            }
        }

        cleanData(type, json) {
            if (!json || !json.data) return json;
            let count = 0;
            const isDev = this.config.get('devMode');

            if (type === 'feed' && this.config.get('filterFeed') && json.data.item) {
                const before = json.data.item.length;
                json.data.item = json.data.item.filter(item => {
                    if (['ad', 'live', 'game_card'].includes(item.goto)) return false;
                    const { blocked, keyword } = this.ruleManager.check(item.title);
                    if (blocked) {
                        if (item.owner) this.tryBlockUser(item.owner.mid, item.owner.name);
                        // DevMode 下不删除，留给 DOMCleaner 高亮
                        if (isDev) return true;
                        return false;
                    }
                    if (this.config.get('blockDefaultAvatars') && item.owner && /^bili_\d+$/.test(item.owner.name)) return false;
                    return true;
                });
                count = before - json.data.item.length;
            } else if (type === 'comment' && this.config.get('filterComments') && json.data.replies) {
                const filterReplies = (list) => list ? list.filter(r => {
                    if (!r || !r.content || !r.member) return false;
                    const { blocked, keyword } = this.ruleManager.check(r.content.message);
                    if (blocked) {
                        this.tryBlockUser(r.member.mid, r.member.uname);
                        // DevMode 下不删除，留给 DOMCleaner 高亮
                        if (isDev) return true;
                        return false;
                    }
                    if (this.config.get('blockDefaultAvatars') && /^bili_\d+$/.test(r.member.uname)) return false;
                    return true;
                }).map(r => {
                    if (r.replies) r.replies = filterReplies(r.replies);
                    return r;
                }) : [];

                const before = json.data.replies.length;
                json.data.replies = filterReplies(json.data.replies);
                count = before - json.data.replies.length;
            }

            if (count > 0) this.logger.info(`过滤 ${count} 条${type === 'feed' ? '内容' : '评论'}`);
            return json;
        }
    }

    /**
     * ============================================================
     * 模块名称：Cleaner
     * 模块功能：基于 DOM 的广告清理与弹幕/评论可视化标记
     * ============================================================
     */
    class Cleaner {
        constructor(ruleManager) {
            this.config = ConfigManager.getInstance();
            this.ruleManager = ruleManager;
            this.logger = LogManager.getInstance();
        }

        async init() {
            const body = await DOMUtils.waitForBody();
            
            // 广告 DOM 清理
            if (this.config.get('blockAds')) {
                const observer = new MutationObserver(() => this.cleanGhostCards());
                observer.observe(body, { childList: true, subtree: true });
                setInterval(() => this.cleanGhostCards(), 2500);
            }

            // 弹幕拦截 & 高亮
            if (this.config.get('filterDanmaku')) {
                this.logger.info("✅ 弹幕力场展开");
                const dmObserver = new MutationObserver((mutations) => {
                    mutations.forEach(m => m.addedNodes.forEach(node => {
                        if (node.nodeType === 1) this.checkDanmaku(node);
                    }));
                });
                
                const playerObserver = new MutationObserver(() => {
                    const dmLayer = document.querySelector('.b-danmaku') || document.querySelector('.bilibili-player-video-danmaku');
                    if (dmLayer) {
                        dmObserver.observe(dmLayer, { childList: true, subtree: true });
                        dmLayer.querySelectorAll('*').forEach(n => this.checkDanmaku(n));
                    }
                });
                playerObserver.observe(body, { childList: true, subtree: true });
            }

            // 开发者模式：评论与推荐流 DOM 扫描高亮
            if (this.config.get('devMode')) {
                this.startDevModeObserver(body);
            }
        }

        // 开发者模式下的 DOM 扫描器
        startDevModeObserver(body) {
            const highlightObserver = new MutationObserver((mutations) => {
                mutations.forEach(m => {
                    m.addedNodes.forEach(node => {
                        if (node.nodeType !== 1) return;
                        // 检查评论
                        if (node.matches && (node.matches('.reply-item') || node.matches('bili-comment-thread-renderer'))) {
                            this.highlightNode(node, '.reply-content', '评论');
                        } else {
                            if (node.querySelector) {
                                const replies = node.querySelectorAll('.reply-item, bili-comment-thread-renderer');
                                replies.forEach(r => this.highlightNode(r, '.reply-content', '评论'));
                            }
                        }
                        // 检查推荐卡片
                        if (node.matches && node.matches('.bili-video-card')) {
                            this.highlightNode(node, '.bili-video-card__info--tit', '标题');
                        }
                    });
                });
            });
            highlightObserver.observe(body, { childList: true, subtree: true });
        }

        // 通用高亮逻辑
        highlightNode(node, textSelector, type) {
            const textEl = node.querySelector(textSelector);
            if (!textEl) return;
            const text = textEl.innerText;
            const { blocked, keyword } = this.ruleManager.check(text);
            
            if (blocked && keyword) {
                // 红色边框
                node.style.border = "3px solid #FF0000";
                node.style.borderRadius = "4px";
                node.style.position = "relative";
                node.setAttribute('title', `[全能护盾] 命中规则: ${keyword}`);
                
                // 关键词高亮 (红底白字)
                const keywordStr = keyword instanceof RegExp ? keyword.source : keyword;
                try {
                    // 简单的高亮替换，防止破坏 HTML 结构需谨慎，这里假设内容主要是文本
                    // 为了安全起见，只替换 textContent 匹配到的部分
                    const regex = new RegExp(keyword, 'g');
                    textEl.innerHTML = textEl.innerHTML.replace(regex, match => `<span style="background:#FF0000;color:#FFF;padding:2px;border-radius:2px;font-weight:bold;">${match}</span>`);
                } catch(e) {}
                
                this.logger.block(`[DevMode] 标记${type}: ${keyword}`);
            }
        }

        cleanGhostCards() {
            const feedCards = document.querySelectorAll('.feed-card');
            feedCards.forEach(card => {
                if (card.style.display === 'none') return;
                const videoCard = card.querySelector('.bili-video-card');
                if (videoCard) {
                    const hasInfo = videoCard.querySelector('.bili-video-card__info');
                    const hasSkeleton = videoCard.querySelector('.bili-video-card__skeleton');
                    if (!hasInfo && !hasSkeleton) card.style.display = 'none';
                }
            });
        }

        checkDanmaku(node) {
            if (!node.textContent) return;
            const { blocked, keyword } = this.ruleManager.check(node.textContent);
            
            if (blocked) {
                if (this.config.get('devMode')) {
                    // DevMode: 红框标记 + 高亮关键词
                    node.style.border = "2px solid red";
                    node.style.zIndex = "999999";
                    try {
                        const regex = new RegExp(keyword, 'g');
                        node.innerHTML = node.innerHTML.replace(regex, match => `<span style="background:#FF0000;color:#FFF;border:1px solid #FFF;">${match}</span>`);
                    } catch(e) {}
                } else {
                    // Normal: 隐藏
                    node.style.display = 'none';
                    node.style.visibility = 'hidden';
                    node.innerHTML = '';
                }
            }
        }
    }

    /**
     * ============================================================
     * 模块名称：QualityUnlocker
     * 模块功能：解锁 1080P+ 画质
     * ============================================================
     */
    class QualityUnlocker {
        constructor() {
            this.config = ConfigManager.getInstance();
            this.logger = LogManager.getInstance();
        }

        init() {
            if (document.cookie.includes('DedeUserID')) return; // 已登录跳过
            if (this.config.get('unlockHighQuality')) {
                this.logger.info("✅ 画质解锁");
                this.unlock();
            } else {
                this.clean();
            }
        }

        clean() {
            try {
                localStorage.removeItem('bpx_player_profile');
                localStorage.removeItem('bilibili_player_codec_prefer_type');
            } catch (e) {}
        }

        unlock() {
            // 模拟本地存储
            ['bilibili_player_codec_prefer_type', 'b_miniplayer', 'recommend_auto_play', 'bpx_player_profile'].forEach(k => {
                const v = GM_getValue(k);
                if (v) localStorage.setItem(k, v);
            });

            // 拦截 setItem 防止被覆盖
            const originSetItem = localStorage.setItem;
            localStorage.setItem = function(k, v) {
                if (k === 'bpx_player_profile') {
                    try {
                        const p = JSON.parse(v);
                        if (!p.audioEffect) p.audioEffect = {};
                        v = JSON.stringify(p);
                    } catch (e) {}
                }
                originSetItem.call(this, k, v);
            };

            // 欺骗播放器检测
            Object.defineProperty(Object.prototype, 'isViewToday', { get: () => true, configurable: true });
            Object.defineProperty(Object.prototype, 'isVideoAble', { get: () => true, configurable: true });

            // 延时策略
            const originSetTimeout = unsafeWindow.setTimeout;
            unsafeWindow.setTimeout = function(f, d) {
                if (d === 3e4) d = 3e8; // 延迟登录检测
                return originSetTimeout.call(this, f, d);
            };

            // 自动关闭登录框并切换画质
            setInterval(() => {
                const btn = document.querySelector('.bpx-player-toast-confirm-login');
                if (btn) {
                    btn.click();
                    if (this.config.get('waitHighQualityLoad') && unsafeWindow.player) {
                        const el = unsafeWindow.player.mediaElement();
                        if (el && !el.paused) {
                            el.pause();
                            setTimeout(() => el.play(), 500);
                        }
                    }
                    setTimeout(() => {
                        if (unsafeWindow.player) {
                            const qualityMap = { '1080': 80, '720': 64, '480': 32 };
                            const q = qualityMap[this.config.get('preferQuality')] || 80;
                            unsafeWindow.player.requestQuality(q);
                        }
                    }, 5000);
                }
            }, 2000);
        }
    }

    /**
     * ============================================================
     * 模块名称：CommentUnlocker
     * 模块功能：未登录查看评论（核心业务逻辑）
     * ============================================================
     */
    class CommentUnlocker {
        constructor() {
            this.config = ConfigManager.getInstance();
            this.logger = LogManager.getInstance();
            this.oid = null;
            this.createrID = null;
            this.commentType = null;
            this.replyList = null;
            this.sortType = 3; // 3=Hot, 2=Time
            this.offsetStore = {};
            this.replyPool = {};
            this._wbiCache = null;
        }

        init() {
            if (document.cookie.includes('DedeUserID') || !this.config.get('unlockGuestComments')) return;
            this.logger.info("✅ 评论解锁");
            this.start();
            
            // SPA 路由监听
            let lastUrl = location.href;
            setInterval(() => {
                if (lastUrl !== location.href) {
                    lastUrl = location.href;
                    this.start();
                }
            }, 1000);
        }

        async start() {
            this.resetState();
            await this.setupContainer();
            await this.collectData();
            await this.bindEvents();
            await this.loadPage(1);
        }

        resetState() {
            this.oid = this.createrID = this.commentType = this.replyList = undefined;
            this.replyPool = {};
            this.sortType = 3;
        }

        async setupContainer() {
            const container = await new Promise(resolve => {
                const timer = setInterval(() => {
                    const std = document.querySelector('.comment-container');
                    const shadow = document.querySelector('bili-comments');
                    const wrapper = document.querySelector('.comment-wrapper .common');
                    const target = std || shadow || wrapper;
                    if (target) { clearInterval(timer); resolve(target); }
                }, 200);
            });

            if (!container.classList.contains('comment-container')) {
                const html = `
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
                if (container.parentElement) container.parentElement.innerHTML = html;
                else container.innerHTML = html;
            }
        }

        async collectData() {
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
                    } else if (/https:\/\/t\.bilibili\.com\/\d+/.test(loc.href)) {
                        const dynID = loc.pathname.replace('/', '');
                        try {
                            const dynDetail = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${dynID}`).then(res => res.json());
                            this.oid = dynDetail?.data?.item?.basic?.comment_id_str;
                            this.commentType = dynDetail?.data?.item?.basic?.comment_type;
                            this.createrID = dynDetail?.data?.item?.modules?.module_author?.mid;
                        } catch(e) {}
                    } else if (/https:\/\/www\.bilibili\.com\/read\/cv\d+.*/.test(loc.href)) {
                        this.oid = global?.__INITIAL_STATE__?.cvid;
                        this.createrID = global?.__INITIAL_STATE__?.readInfo?.author?.mid;
                        this.commentType = 12;
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

        async bindEvents() {
            const nav = document.querySelector('.comment-container .reply-header .nav-sort');
            if (!nav) return;
            const hot = nav.querySelector('.hot-sort');
            const time = nav.querySelector('.time-sort');
            nav.classList.add('hot'); nav.classList.remove('time');

            hot.addEventListener('click', () => {
                if (this.sortType === 3) return;
                this.sortType = 3;
                nav.classList.add('hot'); nav.classList.remove('time');
                this.loadPage(1);
            });
            time.addEventListener('click', () => {
                if (this.sortType === 2) return;
                this.sortType = 2;
                nav.classList.add('time'); nav.classList.remove('hot');
                this.loadPage(1);
            });
        }

        async loadPage(pageNum) {
            if (pageNum === 1) {
                this.offsetStore = { 1: `{"offset":""}` };
                this.replyPool = {};
                this.replyList.innerHTML = '<p style="padding: 40px 0; text-align: center; color: #999;">正在加载评论...</p>';
                document.querySelector('.page-switcher')?.remove();
            }

            const { data, code } = await this.fetchComments(pageNum);

            if (code !== 0) {
                this.replyList.innerHTML = `<p style="padding: 100px 0; text-align: center; color: #999;">无法获取评论 (Code: ${code})</p>`;
                return;
            }

            if (pageNum === 1) {
                this.replyList.innerHTML = '';
                const countEl = document.querySelector('.comment-container .reply-header .total-reply');
                if (countEl) countEl.textContent = data?.cursor?.all_count || 0;
                
                if (data.top_replies && data.top_replies.length) {
                    this.renderItem(data.top_replies[0], true);
                }
            }

            if (!data.replies || data.replies.length === 0) {
                if (pageNum === 1) {
                    this.replyList.innerHTML += '<p style="padding-bottom: 100px; text-align: center; color: #999;">没有更多评论</p>';
                } else {
                    Toast.info('没有更多了');
                }
                return;
            }

            data.replies.forEach(r => this.renderItem(r));
            if (pageNum === 1) this.addPager();
            
            // 更新 UI 状态
            const pager = document.querySelector('.page-switcher-current-page');
            if (pager) pager.textContent = pageNum;
        }

        async fetchComments(pageNum) {
            const params = { 
                oid: this.oid, 
                type: this.commentType, 
                mode: this.sortType, 
                wts: parseInt(Date.now() / 1000),
                pagination_str: this.offsetStore[pageNum]
            };

            if (params.pagination_str === 'no-next-offset') return { code: 0, data: { replies: [] } };

            const query = await this.signWbi(params);
            const res = await fetch(`https://api.bilibili.com/x/v2/reply/wbi/main?${query}`).then(r => r.json());
            
            if (res.code === 0) {
                const next = res.data?.cursor?.pagination_reply?.next_offset;
                this.offsetStore[pageNum + 1] = next ? `{"offset":"${next}"}` : 'no-next-offset';
            }
            return res;
        }

        async signWbi(params) {
            if (!this._wbiCache || Date.now() - this._wbiCache.time > 5 * 60 * 1000) {
                const nav = await fetch('https://api.bilibili.com/x/web-interface/nav').then(r => r.json());
                const imgKey = nav.data.wbi_img.img_url.split('/').pop().split('.')[0];
                const subKey = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0];
                const mixinTable = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
                const mixinKey = mixinTable.map(n => (imgKey + subKey)[n]).join('').slice(0, 32);
                this._wbiCache = { mixinKey, time: Date.now() };
            }
            const query = Object.keys(params).sort().map(key => 
                `${encodeURIComponent(key)}=${encodeURIComponent(params[key].toString().replace(/[!'()*]/g, ''))}`
            ).join('&');
            return query + '&w_rid=' + SparkMD5.hash(query + this._wbiCache.mixinKey);
        }

        renderItem(data, isTop = false) {
            if (this.replyPool[data.rpid_str]) return;
            const el = document.createElement('div');
            el.className = 'reply-item';
            
            const pendant = (this.config.get('enableFanMedal') && data.member.pendant.image)
                ? `<div class="bili-avatar-pendent-dom"><img src="${data.member.pendant.image}"></div>` : '';
            
            const medal = (this.config.get('enableFanMedal') && data.member.fans_detail)
                ? `<div class="fan-medal ${data.member.fans_detail.guard_icon?'fan-medal-with-guard-icon':''}"><img class="fan-medal-icon" src="${data.member.fans_detail.guard_icon || 'https://i0.hdslb.com/bfs/live/82d48274d0d84e2c328c4353c38def6eaf5de27a.png'}" style="${!data.member.fans_detail.guard_icon ? 'display:none':''}"><div class="fan-medal-name">${data.member.fans_detail.medal_name}</div><div class="fan-medal-level">${data.member.fans_detail.level}</div></div>` : '';
            
            const images = data.content.pictures
                ? `<div class="preview-image-container" style="display:flex;margin:8px 0;">${data.content.pictures.map(p=>`<div style="margin-right:4px;cursor:zoom-in"><img src="${p.img_src}" style="border-radius:4px;width:96px;height:96px;object-fit:cover;"></div>`).join('')}</div>` : '';
            
            const notePrefix = (this.config.get('enableNotePrefix') && data.content.pictures)
                ? `<div class="note-prefix"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25ZM3.5 6.25a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm.75 2.25h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z"></path></svg> 笔记</div>` : '';

            el.innerHTML = `
              <div class="root-reply-container">
                <div class="root-reply-avatar">
                  <div class="avatar"><div class="bili-avatar"><img class="bili-avatar-img" src="${data.member.avatar}">${pendant}</div></div>
                </div>
                <div class="content-warp">
                  <div class="user-info">
                    <a class="user-name" target="_blank" href="//space.bilibili.com/${data.member.mid}" style="color: ${data.member.vip.nickname_color || '#61666d'}">${data.member.uname}</a>
                    <span style="height:16px;line-height:16px;padding:0 2px;margin-right:4px;font-size:12px;color:white;border-radius:2px;background-color:${this.getLevelColor(data.member.level_info.current_level)}">LV${data.member.level_info.current_level}</span>
                    ${this.createrID === data.mid ? '<span style="font-size:12px;background:#FF6699;color:white;padding:0 4px;border-radius:2px;margin-right:4px;">UP</span>' : ''}
                    ${medal}
                  </div>
                  <div class="root-reply">
                    <span class="reply-content-container root-reply">
                      <span class="reply-content">${isTop?'<span style="color:#FF6699;margin-right:4px;font-weight:bold;">[置顶]</span>':''}${notePrefix}${this.processContent(data.content.message)}</span>
                    </span>
                    ${images}
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
            if (data.content.pictures && typeof Viewer !== 'undefined') new Viewer(el.querySelector('.preview-image-container'), { title: false, toolbar: false });
        }

        renderSubReplies(replies) {
            if (!replies || !replies.length) return '';
            return replies.map(r => `
                <div class="sub-reply-item">
                    <div class="sub-reply-avatar"><img src="${r.member.avatar}"></div>
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

        addPager() {
            const container = document.querySelector('.comment-container .reply-warp');
            const switcher = document.createElement('div');
            switcher.className = 'page-switcher';
            switcher.innerHTML = `<div class="page-switcher-wrapper"><span class="page-switcher-prev-btn">上一页</span><span class="page-switcher-current-page">1</span><span class="page-switcher-next-btn">下一页</span></div>`;
            container.appendChild(switcher);

            let page = 1;
            switcher.querySelector('.page-switcher-prev-btn').onclick = () => {
                if (page > 1) {
                    page--;
                    this.replyList.innerHTML = '';
                    this.loadPage(page);
                    document.documentElement.scrollTop = document.querySelector('.comment-container').offsetTop - 60;
                }
            };
            switcher.querySelector('.page-switcher-next-btn').onclick = () => {
                page++;
                this.replyList.innerHTML = '';
                this.loadPage(page);
                document.documentElement.scrollTop = document.querySelector('.comment-container').offsetTop - 60;
            };
        }

        processContent(msg) {
            if (!msg) return '';
            return msg.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
                      .replace(/\[(.*?)\]/g, (match) => `<span style="color:#666;">${match}</span>`);
        }
        formatTime(ts) { const d=new Date(ts*1000); return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; }
        getLevelColor(l) { return ['#C0C0C0','#BBBBBB','#8BD29B','#7BCDEF','#FEBB8B','#EE672A','#F04C49'][l] || '#C0C0C0'; }
        b2a(bvid) { const XOR=23442827791579n,MASK=2251799813685247n,BASE=58n,A='FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf',MAP=[0,1,2,9,7,5,6,4,8,3,10,11]; let r=0n; for(let i=3;i<12;i++) r=r*BASE+BigInt(A.indexOf(bvid[MAP[i]])); return `${r&MASK^XOR}`; }
    }

    /**
     * ============================================================
     * 模块名称：SettingsUI
     * 模块功能：基于 Shadow DOM 的设置面板
     * ============================================================
     */
    class SettingsUI {
        constructor(ruleManager, styleManager) {
            this.ruleManager = ruleManager;
            this.styleManager = styleManager;
            this.config = ConfigManager.getInstance();
            this.logger = LogManager.getInstance();
            this.root = null;
            this.shadow = null;
            this.isOpen = false;
        }

        async init() {
            GM_registerMenuCommand("⚡ 强制重置 UI", () => { 
                if (this.root) this.root.remove(); 
                this.render(); 
                Toast.success("UI 已重置"); 
            });
            await DOMUtils.waitForBody();
            this.render();
            // 订阅日志更新
            this.logger.subscribe(() => this.updateLogView());
        }

        render() {
            if (document.getElementById('bili-shield-root')) return;
            this.root = document.createElement('div');
            this.root.id = 'bili-shield-root';
            this.root.style.cssText = "position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;";
            document.body.appendChild(this.root);

            this.shadow = this.root.attachShadow({ mode: 'open' });
            this.shadow.innerHTML = this.getStyles() + this.getHTML();
            this.bindEvents();
            this.updateStats();
        }

        getStyles() {
            return `<style>
            :host { --pink:#FF6699; --pink-light:#FFEBF1; --blue:#00AEEC; --orange:#F4A460; --text:#555; --bg:rgba(255,255,255,0.95); }
            * { box-sizing:border-box; font-family:"HarmonyOS Sans","PingFang SC","Microsoft YaHei",sans-serif; }
            .entry-btn { position:fixed; bottom:80px; right:24px; width:56px; height:56px; background:radial-gradient(circle at 30% 30%, #FFD700, #F4A460); border-radius:50%; box-shadow:0 6px 16px rgba(244,164,96,0.4), inset 0 2px 4px rgba(255,255,255,0.5); cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:10000; transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1); animation:float 3s ease-in-out infinite; border:2px solid #FFF; }
            .entry-btn:hover { transform:scale(1.15) rotate(360deg); box-shadow:0 12px 28px rgba(244,164,96,0.6); }
            .entry-btn::after { content:'⚡'; font-size:26px; color:#FFF; text-shadow:0 1px 2px rgba(0,0,0,0.2); }
            @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
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

        getHTML() {
            return `
            <div class="entry-btn" id="toggleBtn" title="超电磁炮准备就绪"></div>
            <div class="panel" id="mainPanel">
                <div class="header"><div class="title">⚡ 全能护盾 <span class="badge">V1.3.1</span></div><div class="close-btn" id="closePanel">✕</div></div>
                <div class="tabs">
                    <div class="tab active" data-target="home">通用</div><div class="tab" data-target="shield">净化</div>
                    <div class="tab" data-target="unlock">解锁</div><div class="tab" data-target="dev">日志</div>
                </div>
                <div class="content">
                    <div class="view active" id="home">
                        <div class="stats-card"><div class="stats-num" id="keywordCount">...</div><div class="stats-label">御坂网络·规则覆盖中</div></div>
                        <div class="setting-item"><span class="label">🚫 禁止自动弹出登录</span><label class="switch"><input type="checkbox" id="sw_blockLoginPopups"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🌸 经典顶栏</span><label class="switch"><input type="checkbox" id="sw_pinkHeader"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🛠️ 开发者模式 (标记不拦截)</span><label class="switch"><input type="checkbox" id="sw_devMode"><span class="slider"></span></label></div>
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
                        <div class="setting-item"><span class="label">🎨 偏好画质</span><select id="sel_preferQuality"><option value="1080">1080P</option><option value="720">720P</option><option value="480">480P</option></select></div>
                        <div class="setting-item"><span class="label">👀 未登录看评论</span><label class="switch"><input type="checkbox" id="sw_unlockGuestComments"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">🏅 显示粉丝勋章</span><label class="switch"><input type="checkbox" id="sw_enableFanMedal"><span class="slider"></span></label></div>
                        <div class="setting-item"><span class="label">📝 显示笔记前缀</span><label class="switch"><input type="checkbox" id="sw_enableNotePrefix"><span class="slider"></span></label></div>
                    </div>
                    <div class="view" id="dev"><div class="log-box" id="logContainer"></div></div>
                </div>
            </div>`;
        }

        bindEvents() {
            const $ = (s) => this.shadow.querySelector(s);
            const $$ = (s) => this.shadow.querySelectorAll(s);

            $('#toggleBtn').onclick = () => { this.isOpen = !this.isOpen; $('#mainPanel').classList.toggle('open', this.isOpen); };
            $('#closePanel').onclick = () => { this.isOpen = false; $('#mainPanel').classList.remove('open'); };

            $$('.tab').forEach(t => t.onclick = () => {
                $$('.tab').forEach(x => x.classList.remove('active'));
                $$('.view').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                $(`#${t.dataset.target}`).classList.add('active');
                if (t.dataset.target === 'dev') this.updateLogView();
            });

            $('#btnUpdate').onclick = () => {
                const btn = $('#btnUpdate');
                btn.innerText = "正在连接御坂网络...";
                this.ruleManager.forceUpdate();
                setTimeout(() => btn.innerText = "立即更新云端词库", 2000);
            };

            const bindSwitch = (id, key) => {
                const el = $(`#${id}`);
                if (!el) return;
                
                if (id === 'sw_devMode') {
                    el.checked = GM_getValue('cfg_dev_mode', false);
                    el.onchange = (e) => { 
                        GM_setValue('cfg_dev_mode', e.target.checked); 
                        location.reload(); 
                    };
                    return;
                }

                if (el.type === 'checkbox') {
                    el.checked = this.config.get(key);
                    el.onchange = (e) => {
                        this.config.set(key, e.target.checked);
                        this.handleConfigChange(key, e.target.checked);
                    };
                } else {
                    el.value = this.config.get(key);
                    el.onchange = (e) => this.config.set(key, e.target.value);
                }
            };

            ['pinkHeader', 'hideCarousel', 'hideFloorCard', 'hideLeftLocEntry', 'filterFeed', 'filterComments', 'blockAds', 'blockDefaultAvatars',
             'unlockHighQuality', 'waitHighQualityLoad', 'unlockGuestComments', 'enableFanMedal', 'enableNotePrefix', 'autoBlockUser', 'blockNews', 'blockLoginPopups', 'filterDanmaku', 'devMode']
            .forEach(k => bindSwitch(`sw_${k}`, k));
            bindSwitch('sel_preferQuality', 'preferQuality');
        }

        handleConfigChange(key, value) {
            if (['blockAds', 'pinkHeader', 'hideFloorCard', 'blockDefaultAvatars', 'blockLoginPopups', 'unlockGuestComments', 'enableFanMedal'].includes(key)) {
                this.styleManager.refresh();
            }
            if (key === 'blockNews') {
                this.ruleManager.init();
            }
        }

        updateStats() {
            const countEl = this.shadow.querySelector('#keywordCount');
            if (countEl) countEl.innerText = this.ruleManager.getStats();
        }

        updateLogView() {
            const con = this.shadow.querySelector('#logContainer');
            if (!this.logger.isDevMode) {
                con.innerHTML = '<div style="padding:40px;text-align:center;color:#999">请开启开发者模式<br>(✧ω✧)</div>';
                return;
            }
            con.innerHTML = this.logger.logs.slice().reverse().map(l => 
                `<div style="margin-bottom:6px;border-bottom:1px solid #E3E5E7;padding-bottom:4px"><span style="color:#999;font-size:11px">[${l.time}]</span> <b style="color:${l.type==='BLOCK'||l.type==='RAILGUN'?'#FF6699':'#00AEEC'};margin:0 4px">${l.type}</b> ${l.msg}</div>`
            ).join('');
        }
    }

    /**
     * ============================================================
     * 模块名称：Bootstrap
     * 模块功能：启动入口
     * ============================================================
     */
    function main() {
        const logger = LogManager.getInstance();
        const config = ConfigManager.getInstance();
        const ruleManager = new RuleManager();
        const styleManager = new StyleManager();

        styleManager.refresh();

        const networkProxy = new NetworkProxy(ruleManager);
        networkProxy.enable();

        const cleaner = new Cleaner(ruleManager);
        cleaner.init();

        const qualityUnlocker = new QualityUnlocker();
        qualityUnlocker.init();

        const commentUnlocker = new CommentUnlocker();
        commentUnlocker.init();

        const ui = new SettingsUI(ruleManager, styleManager);
        ui.init();

        logger.info('全能护盾已启动 - Railgun Ultimate (Refactored)');
    }

    main();

})();
