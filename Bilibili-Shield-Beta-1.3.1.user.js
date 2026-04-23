// ==UserScript==
// @name         Bilibili Omnipotent Shield (Bilibili 全能护盾) - Railgun Ultimate (Release)
// @namespace    http://tampermonkey.net/
// @version      1.4.0-Release
// @description  哔哩哔哩全能护盾 - 高性能净化、未登录评论修复、稳定正则词库支持
// @author       Sakurairinaqwq & DD1969 & Merged
// @match        *://*.bilibili.com/*
// @match        https://t.bilibili.com/*
// @match        https://space.bilibili.com/*
// @match        https://manga.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @connect      api.bilibili.com
// @connect      bilishield.resonera.cn
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

    const SCRIPT_VERSION = '1.4.0-Release';
    const RULE_CACHE_KEY = 'bili_shield_rules_v3';
    const RULE_LAST_UPDATE_KEY = 'bili_shield_last_update';
    const LOG_LIMIT = 240;
    const RECENT_MATCH_LIMIT = 24;
    const INVALID_RULE_LIMIT = 40;
    const URL_CHANGE_EVENT = 'bili-shield:urlchange';

    const STATE = {
        logs: [],
        isDevMode: GM_getValue('cfg_dev_mode', false),
        stats: {
            feedFiltered: 0,
            commentFiltered: 0,
            danmakuFiltered: 0,
            adHidden: 0
        },
        debug: {
            invalidRules: [],
            recentMatches: [],
            ruleSummary: {
                blackStrings: 0,
                blackRegex: 0,
                whiteStrings: 0,
                whiteRegex: 0,
                total: 0,
                invalidRegex: 0
            }
        }
    };

    const CONFIG = {
        debug: true,
        remoteBanListUrl: 'https://bilishield.resonera.cn/%E5%85%A8%E8%83%BD%E6%8A%A4%E7%9B%BE%E5%BA%93/%E8%BF%9D%E7%A6%81%E8%AF%8D/ban.json',
        updateInterval: 24 * 60 * 60 * 1000,
        settings: {
            blockLoginPopups: GM_getValue('cfg_blockLoginPopups', false),
            blockAds: GM_getValue('cfg_blockAds', false),
            filterFeed: GM_getValue('cfg_filterFeed', false),
            filterComments: GM_getValue('cfg_filterComments', false),
            filterDanmaku: GM_getValue('cfg_filterDanmaku', false),
            autoBlockUser: GM_getValue('cfg_autoBlockUser', false),
            blockDefaultAvatars: GM_getValue('cfg_blockDefaultAvatars', false),
            blockNews: GM_getValue('cfg_blockNews', false),
            pinkHeader: GM_getValue('cfg_pinkHeader', false),
            hideCarousel: GM_getValue('cfg_hideCarousel', false),
            hideFloorCard: GM_getValue('cfg_hideFloorCard', false),
            hideLeftLocEntry: GM_getValue('cfg_hideLeftLocEntry', false),
            unlockHighQuality: GM_getValue('cfg_unlockHighQuality', false),
            preferQuality: GM_getValue('cfg_preferQuality', '1080'),
            waitHighQualityLoad: GM_getValue('cfg_waitHighQualityLoad', false),
            unlockGuestComments: GM_getValue('cfg_unlockGuestComments', false),
            enableFanMedal: GM_getValue('cfg_enableFanMedal', true),
            enableNotePrefix: GM_getValue('cfg_enableNotePrefix', true)
        },
        localKeywords: ['免费教程', '实操变现', '日入', '加我', 'v信', '淘宝', '兼职'],
        newsKeywords: ['新闻', '资讯', '日报', '周刊', '快讯', '热点', '头条', 'CCTV', '央视', '新华社', '人民日报', '环球网', '观察者网', '凤凰网', '澎湃', '财新', '路透', 'BBC', 'CNN', '联播', '时政', '民生', '外交部', '白宫', '俄乌', '巴以', '战争', '局势']
    };

    const Logger = {
        push(type, msg, data = null) {
            const time = new Date().toLocaleTimeString();
            STATE.logs.push({ time, type, msg, data });
            if (STATE.logs.length > LOG_LIMIT) STATE.logs.shift();
            if (window._biliShieldUpdateLogs) window._biliShieldUpdateLogs();
            if (CONFIG.debug && STATE.isDevMode) {
                console.log(`%c[Shield:${type}] ${msg}`, 'color:#FF6699;font-weight:bold;', data || '');
            }
        },
        info(msg, data = null) { this.push('CONNECT', msg, data); },
        warn(msg, data = null) { this.push('WARNING', msg, data); },
        action(msg, data = null) { this.push('RAILGUN', msg, data); },
        suppressErrors() {
            const originalConsoleError = console.error;
            console.error = function(...args) {
                const str = args.map(item => String(item)).join(' ');
                if (str.includes('Cannot read properties of undefined') && str.includes('render')) return;
                originalConsoleError.apply(console, args);
            };
        }
    };

    const Utils = {
        waitForBody() {
            return this.waitForElement(() => document.body, { root: document.documentElement, timeout: 15000 });
        },

        waitForElement(getter, { root = document.documentElement, timeout = 15000, signal = null } = {}) {
            return new Promise((resolve, reject) => {
                let settled = false;
                let observer = null;
                let timer = null;

                const read = () => {
                    try {
                        return typeof getter === 'function' ? getter() : document.querySelector(getter);
                    } catch (error) {
                        return null;
                    }
                };

                const cleanup = () => {
                    if (observer) observer.disconnect();
                    if (timer) clearTimeout(timer);
                    if (signal) signal.removeEventListener('abort', onAbort);
                };

                const finish = (value, error = null) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    if (error) reject(error);
                    else resolve(value);
                };

                const onAbort = () => finish(null, new DOMException('Aborted', 'AbortError'));

                const initial = read();
                if (initial) {
                    finish(initial);
                    return;
                }

                if (signal?.aborted) {
                    onAbort();
                    return;
                }

                if (root) {
                    observer = new MutationObserver(() => {
                        const next = read();
                        if (next) finish(next);
                    });
                    observer.observe(root, { childList: true, subtree: true });
                }

                if (timeout > 0) {
                    timer = setTimeout(() => finish(null, new Error('Timed out waiting for element')), timeout);
                }

                if (signal) signal.addEventListener('abort', onAbort, { once: true });
            });
        },

        ensureUrlObserver() {
            if (this._urlObserverInstalled) return;
            this._urlObserverInstalled = true;
            this._lastUrl = location.href;

            const dispatch = () => {
                if (this._lastUrl === location.href) return;
                this._lastUrl = location.href;
                window.dispatchEvent(new CustomEvent(URL_CHANGE_EVENT, { detail: { url: location.href } }));
            };

            const wrapHistory = key => {
                const original = history[key];
                history[key] = function(...args) {
                    const result = original.apply(this, args);
                    setTimeout(dispatch, 0);
                    return result;
                };
            };

            wrapHistory('pushState');
            wrapHistory('replaceState');
            window.addEventListener('popstate', dispatch);
            window.addEventListener('hashchange', dispatch);
        },

        onUrlChange(handler) {
            this.ensureUrlObserver();
            window.addEventListener(URL_CHANGE_EVENT, handler);
            return () => window.removeEventListener(URL_CHANGE_EVENT, handler);
        },

        isEscaped(str, index) {
            let count = 0;
            for (let i = index - 1; i >= 0 && str[i] === '\\'; i -= 1) count += 1;
            return count % 2 === 1;
        },

        escapeHTML(input) {
            return String(input ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        toNumber(value, fallback = null) {
            const num = Number(value);
            return Number.isFinite(num) ? num : fallback;
        },

        isVideoLikeUrl(url = location.href) {
            return /https:\/\/www\.bilibili\.com\/video\/|https:\/\/www\.bilibili\.com\/bangumi\/play\//.test(url);
        },

        isSupportedCommentUrl(url = location.href) {
            return /https:\/\/www\.bilibili\.com\/video\/|https:\/\/www\.bilibili\.com\/bangumi\/play\/|https:\/\/t\.bilibili\.com\/\d+|https:\/\/www\.bilibili\.com\/read\/cv\d+/.test(url);
        },

        isHomeLikeUrl(url = location.href) {
            return /^https:\/\/www\.bilibili\.com\/($|index\.html|\?)/.test(url) || /^https:\/\/www\.bilibili\.com\/\?/.test(url);
        }
    };

    class UserActionManager {
        constructor() {
            this.csrfToken = this.getCsrf();
        }

        getCsrf() {
            const match = document.cookie.match(/bili_jct=([^;]+)/);
            return match ? match[1] : null;
        }

        blockUser(mid, username) {
            if (!this.csrfToken) {
                Logger.warn('未登录，无法执行自动拉黑');
                return;
            }

            const cacheKey = `shield_blocked_${mid}`;
            if (sessionStorage.getItem(cacheKey)) return;

            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.bilibili.com/x/relation/modify',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Cookie: document.cookie
                },
                data: `fid=${mid}&act=5&re_src=11&csrf=${this.csrfToken}`,
                onload: response => {
                    try {
                        const payload = JSON.parse(response.responseText);
                        if (payload.code === 0) {
                            Logger.action(`自动拉黑: ${username}`);
                            Toast.success(`已将 ${username} 移入黑名单`);
                            sessionStorage.setItem(cacheKey, '1');
                        }
                    } catch (error) {}
                }
            });
        }
    }

    class Toast {
        static async init() {
            if (document.getElementById('bili-shield-toast-container')) return;
            await Utils.waitForBody();

            const container = document.createElement('div');
            container.id = 'bili-shield-toast-container';
            container.style.cssText = 'position:fixed;top:100px;right:20px;z-index:2147483647;display:flex;flex-direction:column;gap:12px;pointer-events:none;align-items:flex-end;';
            document.body.appendChild(container);

            if (document.getElementById('bili-shield-toast-style')) return;
            const style = document.createElement('style');
            style.id = 'bili-shield-toast-style';
            style.textContent = `
                .bs-toast { background: rgba(255,255,255,0.96); backdrop-filter: blur(16px); padding: 12px 20px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,174,236,0.15); display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: bold; color: #444; border: 2px solid #FFF; border-left-width: 5px; opacity: 0; transform: translateX(30px) skewX(-5deg); animation: bsToastIn 0.4s cubic-bezier(0.18,0.89,0.32,1.28) forwards; pointer-events: auto; min-width: 200px; font-family: "HarmonyOS Sans", "PingFang SC", sans-serif; }
                .bs-toast.hide { animation: bsToastOut 0.4s cubic-bezier(0.4,0,0.2,1) forwards !important; }
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
            if (!container) return;

            const toast = document.createElement('div');
            toast.className = `bs-toast ${type}`;
            const icon = type === 'success' ? '✔' : (type === 'error' ? '⚠' : 'ℹ');
            toast.innerHTML = `<span style="font-size:18px">${icon}</span><span>${Utils.escapeHTML(message)}</span>`;
            container.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('hide');
                toast.addEventListener('animationend', () => toast.remove(), { once: true });
            }, 3000);
        }

        static success(msg) { this.show(msg, 'success'); }
        static error(msg) { this.show(msg, 'error'); }
        static info(msg) { this.show(msg, 'info'); }
    }

    class RuleManager {
        constructor() {
            this.cacheKey = RULE_CACHE_KEY;
            this.lastUpdateKey = RULE_LAST_UPDATE_KEY;
            this.rawRules = null;
            this.compiled = this.createCompiledStore();
            this.invalidRules = [];
            this.summary = {
                blackStrings: 0,
                blackRegex: 0,
                whiteStrings: 0,
                whiteRegex: 0,
                total: 0,
                invalidRegex: 0
            };
        }

        init() {
            this.loadFromCache();
            this.checkUpdate();
        }

        createCompiledStore() {
            return {
                black: this.createBucket(),
                white: this.createBucket()
            };
        }

        createBucket() {
            return {
                seen: new Set(),
                exact: new Set(),
                includes: [],
                regex: []
            };
        }

        loadFromCache() {
            const rawData = GM_getValue(this.cacheKey, null);
            this.applyRules(rawData, 'cache');
            const summary = this.getSummary();
            Logger.info(`词库装载: B[${summary.blackStrings}+${summary.blackRegex}] W[${summary.whiteStrings}+${summary.whiteRegex}]`);
        }

        rebuildFromCurrentSource() {
            this.applyRules(this.rawRules, 'rebuild');
        }

        extractRuleLists(payload) {
            if (Array.isArray(payload)) return { blackList: payload, whiteList: [] };
            if (payload && typeof payload === 'object') {
                return {
                    blackList: payload.blacklist || payload.ban || payload.keywords || [],
                    whiteList: payload.whitelist || payload.white || payload.allow || []
                };
            }
            return { blackList: [], whiteList: [] };
        }

        applyRules(payload, source = 'runtime') {
            this.rawRules = payload;
            const compiled = this.createCompiledStore();
            this.invalidRules = [];

            this.addRuleCollection(CONFIG.localKeywords, compiled.black, 'local');
            if (CONFIG.settings.blockNews) {
                this.addRuleCollection(CONFIG.newsKeywords, compiled.black, 'news');
            }

            const { blackList, whiteList } = this.extractRuleLists(payload);
            this.addRuleCollection(blackList, compiled.black, `${source}:black`);
            this.addRuleCollection(whiteList, compiled.white, `${source}:white`);

            this.compiled = compiled;
            this.summary = {
                blackStrings: compiled.black.includes.length,
                blackRegex: compiled.black.regex.length,
                whiteStrings: compiled.white.includes.length,
                whiteRegex: compiled.white.regex.length,
                total: compiled.black.includes.length + compiled.black.regex.length + compiled.white.includes.length + compiled.white.regex.length,
                invalidRegex: this.invalidRules.length
            };

            STATE.debug.invalidRules = this.getInvalidRules();
            STATE.debug.ruleSummary = this.getSummary();

            if (this.invalidRules.length) {
                Logger.warn(`忽略 ${this.invalidRules.length} 条无效正则规则`);
            }
            if (window._biliShieldUpdateStats) window._biliShieldUpdateStats();
            if (window._biliShieldUpdateLogs) window._biliShieldUpdateLogs();
        }

        addRuleCollection(list, bucket, source) {
            if (!Array.isArray(list)) return;
            for (const item of list) this.addRule(item, bucket, source);
        }

        addRule(rawValue, bucket, source) {
            if (typeof rawValue !== 'string') return;
            const value = rawValue.trim();
            if (!value || bucket.seen.has(value)) return;
            bucket.seen.add(value);

            const regexEntry = this.parseRegexLiteral(value);
            if (regexEntry?.invalid) {
                this.invalidRules.push({
                    raw: value,
                    source,
                    error: regexEntry.error
                });
                return;
            }

            if (regexEntry?.regex) {
                bucket.regex.push({
                    raw: value,
                    regex: regexEntry.regex,
                    source
                });
                return;
            }

            bucket.exact.add(value);
            bucket.includes.push(value);
        }

        parseRegexLiteral(value) {
            if (!value.startsWith('/')) return null;
            const endIndex = this.findRegexEnd(value);
            if (endIndex <= 0) return null;

            const pattern = value.slice(1, endIndex);
            const flags = value.slice(endIndex + 1);

            try {
                new RegExp(pattern, flags);
                const safeFlags = flags.replace(/[gy]/g, '');
                return { regex: new RegExp(pattern, safeFlags) };
            } catch (error) {
                return { invalid: true, error: error?.message || 'Invalid regular expression' };
            }
        }

        findRegexEnd(value) {
            for (let index = value.length - 1; index > 0; index -= 1) {
                if (value[index] === '/' && !Utils.isEscaped(value, index)) return index;
            }
            return -1;
        }

        findMatch(text, bucket) {
            if (bucket.exact.has(text)) {
                return { kind: 'string', rule: text };
            }
            for (const rule of bucket.includes) {
                if (text.includes(rule)) return { kind: 'string', rule };
            }
            for (const entry of bucket.regex) {
                if (entry.regex.test(text)) return { kind: 'regex', rule: entry.raw };
            }
            return null;
        }

        validate(text, context = 'generic') {
            if (typeof text !== 'string') return true;
            const value = text.trim();
            if (!value) return true;

            const whiteHit = this.findMatch(value, this.compiled.white);
            if (whiteHit) {
                this.recordMatch(value, context, 'white', whiteHit);
                return true;
            }

            const blackHit = this.findMatch(value, this.compiled.black);
            if (blackHit) {
                this.recordMatch(value, context, 'black', blackHit);
                return false;
            }

            return true;
        }

        recordMatch(value, context, listType, hit) {
            if (!STATE.isDevMode) return;
            STATE.debug.recentMatches.unshift({
                time: new Date().toLocaleTimeString(),
                context,
                listType,
                kind: hit.kind,
                rule: hit.rule,
                preview: value.slice(0, 120)
            });
            if (STATE.debug.recentMatches.length > RECENT_MATCH_LIMIT) {
                STATE.debug.recentMatches.length = RECENT_MATCH_LIMIT;
            }
            if (window._biliShieldUpdateLogs) window._biliShieldUpdateLogs();
        }

        recordFilter(kind, count) {
            if (!count) return;
            if (kind === 'feed') STATE.stats.feedFiltered += count;
            if (kind === 'comment') STATE.stats.commentFiltered += count;
            if (window._biliShieldUpdateLogs) window._biliShieldUpdateLogs();
        }

        recordDanmaku(count) {
            if (!count) return;
            STATE.stats.danmakuFiltered += count;
            if (window._biliShieldUpdateLogs) window._biliShieldUpdateLogs();
        }

        recordAds(count) {
            if (!count) return;
            STATE.stats.adHidden += count;
            if (window._biliShieldUpdateLogs) window._biliShieldUpdateLogs();
        }

        forceUpdate() {
            Logger.info('同步云端数据...');
            this.fetchRemoteList(true);
        }

        checkUpdate() {
            const lastUpdated = GM_getValue(this.lastUpdateKey, 0);
            if (Date.now() - lastUpdated > CONFIG.updateInterval) {
                this.fetchRemoteList();
            }
        }

        fetchRemoteList(isManual = false) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${CONFIG.remoteBanListUrl}?t=${Date.now()}`,
                headers: { 'Cache-Control': 'no-cache' },
                timeout: 15000,
                onload: response => {
                    if (response.status !== 200) {
                        Logger.warn(`词库同步失败: HTTP ${response.status}`);
                        if (isManual) Toast.error('词库更新失败');
                        return;
                    }

                    try {
                        const payload = JSON.parse(response.responseText);
                        GM_setValue(this.cacheKey, payload);
                        GM_setValue(this.lastUpdateKey, Date.now());
                        this.applyRules(payload, 'remote');
                        if (isManual) Toast.success('规则同步完成');
                    } catch (error) {
                        try {
                            const fallbackList = response.responseText.split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean);
                            GM_setValue(this.cacheKey, fallbackList);
                            GM_setValue(this.lastUpdateKey, Date.now());
                            this.applyRules(fallbackList, 'remote-text');
                            if (isManual) Toast.success('基础规则同步完成');
                        } catch (fallbackError) {
                            Logger.warn('词库同步失败: 返回格式不可解析');
                            if (isManual) Toast.error('词库格式错误');
                        }
                    }
                },
                onerror: () => {
                    Logger.warn('词库同步失败: 网络错误');
                    if (isManual) Toast.error('连接超时');
                },
                ontimeout: () => {
                    Logger.warn('词库同步失败: 请求超时');
                    if (isManual) Toast.error('连接超时');
                }
            });
        }

        getSummary() {
            return { ...this.summary };
        }

        getInvalidRules() {
            return this.invalidRules.slice(0, INVALID_RULE_LIMIT);
        }

        getRecentMatches() {
            return STATE.debug.recentMatches.slice(0, RECENT_MATCH_LIMIT);
        }
    }

    class SmartCleaner {
        constructor(ruleManager) {
            this.ruleManager = ruleManager;
            this.feedRoot = null;
            this.hiddenCards = new WeakSet();
            this.discoveryObserver = null;
            this.rootObserver = null;
            this.cleanTimer = null;
            this.pendingScope = null;
            this.fallbackTimer = null;
            this.urlCleanup = null;
        }

        async init() {
            await Utils.waitForBody();
            if (!this.urlCleanup) this.urlCleanup = Utils.onUrlChange(() => this.refresh());
            this.refresh();
        }

        refresh() {
            this.disconnectObservers();
            if (!CONFIG.settings.blockAds || !document.body) return;

            const tryAttach = () => {
                const root = this.findFeedRoot();
                if (!root) return false;
                this.observeFeedRoot(root);
                return true;
            };

            if (!tryAttach()) {
                this.discoveryObserver = new MutationObserver(() => {
                    if (tryAttach()) {
                        this.discoveryObserver?.disconnect();
                        this.discoveryObserver = null;
                    }
                });
                this.discoveryObserver.observe(document.body, { childList: true, subtree: true });
            }

            if (Utils.isHomeLikeUrl()) {
                this.fallbackTimer = window.setInterval(() => {
                    if (CONFIG.settings.blockAds && this.feedRoot) this.cleanGhostCards(this.feedRoot);
                }, 15000);
            }
        }

        disconnectObservers() {
            if (this.discoveryObserver) this.discoveryObserver.disconnect();
            if (this.rootObserver) this.rootObserver.disconnect();
            if (this.cleanTimer) clearTimeout(this.cleanTimer);
            if (this.fallbackTimer) clearInterval(this.fallbackTimer);
            this.discoveryObserver = null;
            this.rootObserver = null;
            this.cleanTimer = null;
            this.fallbackTimer = null;
            this.feedRoot = null;
            this.pendingScope = null;
        }

        findFeedRoot() {
            const card = document.querySelector('.feed-card');
            if (card?.parentElement) return card.parentElement;
            return document.querySelector('.bili-grid, .feed2, .recommended-container, main');
        }

        observeFeedRoot(root) {
            this.feedRoot = root;
            this.rootObserver = new MutationObserver(() => this.scheduleClean(root));
            this.rootObserver.observe(root, { childList: true, subtree: true });
            this.scheduleClean(root);
        }

        scheduleClean(scope) {
            this.pendingScope = scope || this.feedRoot || document;
            if (this.cleanTimer) return;
            this.cleanTimer = window.setTimeout(() => {
                const target = this.pendingScope;
                this.pendingScope = null;
                this.cleanTimer = null;
                this.cleanGhostCards(target || document);
            }, 120);
        }

        collectFeedCards(scope) {
            const cards = [];
            if (!scope) return cards;
            if (scope.matches?.('.feed-card')) cards.push(scope);
            scope.querySelectorAll?.('.feed-card').forEach(card => cards.push(card));
            return cards;
        }

        cleanGhostCards(scope) {
            let hidden = 0;
            for (const card of this.collectFeedCards(scope)) {
                if (this.hiddenCards.has(card) || card.style.display === 'none') continue;
                const videoCard = card.querySelector('.bili-video-card');
                if (!videoCard) continue;

                const hasInfo = videoCard.querySelector('.bili-video-card__info');
                const hasSkeleton = videoCard.querySelector('.bili-video-card__skeleton');
                if (!hasInfo && !hasSkeleton) {
                    card.style.display = 'none';
                    card.style.pointerEvents = 'none';
                    this.hiddenCards.add(card);
                    hidden += 1;
                }
            }

            if (hidden) this.ruleManager.recordAds(hidden);
        }
    }

    class DanmakuCleaner {
        constructor(ruleManager) {
            this.ruleManager = ruleManager;
            this.bodyObserver = null;
            this.layerObserver = null;
            this.layer = null;
            this.pendingNodes = new Set();
            this.flushTimer = null;
            this.urlCleanup = null;
        }

        async init() {
            const body = await Utils.waitForBody();
            if (!this.urlCleanup) this.urlCleanup = Utils.onUrlChange(() => this.refresh());
            if (!this.bodyObserver) {
                this.bodyObserver = new MutationObserver(mutations => {
                    if (!CONFIG.settings.filterDanmaku) return;
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType !== 1) continue;
                            if (this.isDanmakuLayer(node) || node.querySelector?.('.b-danmaku, .bilibili-player-video-danmaku')) {
                                this.attachLayer();
                                return;
                            }
                        }
                    }
                });
                this.bodyObserver.observe(body, { childList: true, subtree: true });
            }
            this.refresh();
        }

        refresh() {
            this.detachLayer();
            if (!CONFIG.settings.filterDanmaku) return;
            this.attachLayer();
        }

        isDanmakuLayer(node) {
            return node.matches?.('.b-danmaku, .bilibili-player-video-danmaku');
        }

        attachLayer() {
            const nextLayer = document.querySelector('.b-danmaku, .bilibili-player-video-danmaku');
            if (!nextLayer || nextLayer === this.layer) return;

            this.detachLayer();
            this.layer = nextLayer;

            this.layerObserver = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) this.queueNode(node);
                    }
                }
            });
            this.layerObserver.observe(nextLayer, { childList: true, subtree: true });
            nextLayer.querySelectorAll('*').forEach(node => this.queueNode(node));
            Logger.info('✅ 弹幕力场展开');
        }

        detachLayer() {
            if (this.layerObserver) this.layerObserver.disconnect();
            if (this.flushTimer) clearTimeout(this.flushTimer);
            this.layerObserver = null;
            this.layer = null;
            this.flushTimer = null;
            this.pendingNodes.clear();
        }

        queueNode(node) {
            if (!node || this.pendingNodes.has(node)) return;
            this.pendingNodes.add(node);
            if (this.flushTimer) return;
            this.flushTimer = window.setTimeout(() => this.flushNodes(), 50);
        }

        flushNodes() {
            this.flushTimer = null;
            let blocked = 0;

            for (const node of this.pendingNodes) {
                if (this.hideNodeIfMatched(node)) blocked += 1;
            }

            this.pendingNodes.clear();
            if (blocked) this.ruleManager.recordDanmaku(blocked);
        }

        hideNodeIfMatched(node) {
            const text = node.textContent?.trim();
            if (!text) return false;
            if (this.ruleManager.validate(text, 'danmaku')) return false;

            node.textContent = '';
            node.style.display = 'none';
            node.style.visibility = 'hidden';
            return true;
        }
    }

    class CSSInjector {
        constructor() {
            this.styleId = 'bili-shield-global-css';
            this.unlockStyleId = 'bili-shield-unlock-css';
        }

        init() {
            this.applyStyles();
            this.injectUnlockStyles();
        }

        applyStyles() {
            let css = '';

            if (CONFIG.settings.blockLoginPopups) {
                css += '.bili-mini-mask, .login-panel-popover, .bpx-player-toast-login, .vip-login-tip, .mini-login-shim, .v-popover-content:has(.login-panel-popover) { display:none !important; pointer-events:none !important; } body, html { overflow:auto !important; }';
            }
            if (CONFIG.settings.blockAds) {
                css += '.adblock-tips, .bili-grid .video-card-common:has(.bili-video-card__info--ad), a[href*="cm.bilibili.com"], #slide_ad, .ad-report, .bili-video-card > div[class^="b0"] { display:none !important; } .feed-card:has(.bili-video-card:not(:has(.bili-video-card__info)):not(:has(.bili-video-card__skeleton))) { display:none !important; }';
            }
            if (CONFIG.settings.pinkHeader) {
                css += '.bili-header__bar { background-color:#F4A460 !important; } .bili-header .right-entry .right-entry-item { color:#fff !important; }';
            }
            if (CONFIG.settings.hideCarousel) css += '.recommended-swipe { display:none !important; }';
            if (CONFIG.settings.hideFloorCard) css += '.floor-single-card { display:none !important; }';
            if (CONFIG.settings.hideLeftLocEntry) css += '.left-loc-entry, .v-popover-wrap.left-loc-entry { display:none !important; }';

            let style = document.getElementById(this.styleId);
            if (!style) {
                style = document.createElement('style');
                style.id = this.styleId;
                document.head.appendChild(style);
            }
            style.textContent = css;
        }

        injectUnlockStyles() {
            let style = document.getElementById(this.unlockStyleId);
            if (!style) {
                style = document.createElement('style');
                style.id = this.unlockStyleId;
                document.head.appendChild(style);
            }

            if (!CONFIG.settings.unlockGuestComments) {
                style.textContent = '';
                return;
            }

            style.textContent = `
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
                .fan-medal { display: inline-flex; align-items: center; height: 14px; margin-left: 2px; margin-right: 4px; border: 0.5px solid rgba(169,195,233,0.18); border-radius: 10px; background-color: rgba(158,186,232,0.2); vertical-align: middle; cursor: pointer; padding-right: 4px; }
                .fan-medal.fan-medal-with-guard-icon { border-color: #8da8e8; background-color: #b4ccff; }
                .fan-medal-icon { margin-right: -6px; width: 20px; height: 20px; overflow: clip; transform: translateX(-3px); object-fit: cover; }
                .fan-medal-name { margin-right: 2px; padding-left: 5px; line-height: 14px; white-space: nowrap; font-size: 9px; color: #577fb8; }
                .fan-medal-with-guard-icon > .fan-medal-name { color: #385599; }
                .fan-medal-level { display: flex; justify-content: center; align-items: center; margin-right: 0.5px; width: 12px; height: 12px; border-radius: 50%; line-height: 1; white-space: nowrap; font-family: sans-serif; font-size: 8px; transform: scale(0.85); color: #9ab0d2; background-color: #ffffff; }
                .fan-medal-with-guard-icon > .fan-medal-level { color: #5e80c4; }
                .page-switcher { display: flex; justify-content: center; margin: 30px 0; }
                .page-switcher-wrapper { display: flex; font-size: 14px; color: #666; user-select: none; align-items: center; gap: 8px; }
                .page-switcher-btn { padding: 8px 16px; border: 1px solid #D7DDE4; border-radius: 4px; cursor: pointer; transition: 0.2s; background: #FFF; color: #666; }
                .page-switcher-btn:hover:not(:disabled) { border-color: #00A1D6; color: #00A1D6; }
                .page-switcher-btn:disabled { opacity: 0.45; cursor: default; }
                .page-switcher-current-page { color: white; background-color: #00A1D6; padding: 8px 16px; border-radius: 4px; cursor: default; min-width: 48px; text-align: center; }
                .jump-link { color: #008DDA; text-decoration: none; }
                .jump-link:hover { text-decoration: underline; }
                .note-prefix { display: inline-flex; align-items: center; color: #999; font-size: 12px; margin-right: 4px; vertical-align: middle; }
                .login-tip, .fixed-reply-box, .v-popover:has(.login-panel-popover) { display: none !important; }
                @media screen and (max-width: 1620px) {
                    .reply-item .root-reply-avatar { width: 40px; min-width: 40px; }
                    .reply-item .root-reply-avatar .avatar,
                    .reply-item .root-reply-avatar .avatar .bili-avatar { width: 40px; height: 40px; }
                }
            `;
        }
    }

    class NetworkInterceptor {
        constructor(ruleManager) {
            this.ruleManager = ruleManager;
            this.actionManager = new UserActionManager();
            this.originalFetch = unsafeWindow.fetch;
            this.originalXHR = unsafeWindow.XMLHttpRequest;
            this.installed = false;
        }

        init() {
            if (this.installed) return;
            this.installFetchInterceptor();
            this.installXHRInterceptor();
            this.installed = true;
        }

        needsFeedProcessing() {
            return CONFIG.settings.blockAds || CONFIG.settings.filterFeed || CONFIG.settings.blockDefaultAvatars || CONFIG.settings.autoBlockUser;
        }

        needsCommentProcessing() {
            return CONFIG.settings.filterComments || CONFIG.settings.blockDefaultAvatars || CONFIG.settings.autoBlockUser;
        }

        isBlockedAdDomain(url) {
            return url.includes('cm.bilibili.com') || url.includes('data.bilibili.com');
        }

        isFeedRequest(url) {
            return url.includes('/x/web-interface/wbi/index/top/feed') || url.includes('/feed/rcmd');
        }

        isCommentRequest(url) {
            return url.includes('/x/v2/reply');
        }

        getRequestKind(url) {
            if (typeof url !== 'string') return null;
            if (CONFIG.settings.blockAds && this.isBlockedAdDomain(url)) return 'blocked-domain';
            if (this.needsFeedProcessing() && this.isFeedRequest(url)) return 'feed';
            if (this.needsCommentProcessing() && this.isCommentRequest(url)) return 'comment';
            return null;
        }

        installFetchInterceptor() {
            const self = this;
            unsafeWindow.fetch = async function(...args) {
                const requestUrl = args[0] instanceof Request ? args[0].url : String(args[0]);
                const kind = self.getRequestKind(requestUrl);

                if (kind === 'blocked-domain') {
                    return self.createStubResponse();
                }

                const response = await self.originalFetch.apply(this, args);
                if (kind !== 'feed' && kind !== 'comment') return response;
                return self.processFetchResponse(response, kind);
            };
        }

        installXHRInterceptor() {
            const self = this;
            unsafeWindow.XMLHttpRequest = class extends self.originalXHR {
                open(method, url, ...rest) {
                    this._shieldUrl = String(url);
                    return super.open(method, url, ...rest);
                }

                send(body) {
                    const kind = self.getRequestKind(this._shieldUrl || '');
                    if (!kind || kind === 'blocked-domain') {
                        if (kind === 'blocked-domain') {
                            try {
                                Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
                                Object.defineProperty(this, 'status', { value: 200, configurable: true });
                                Object.defineProperty(this, 'responseText', { value: JSON.stringify({ code: 0, data: {} }), configurable: true });
                                Object.defineProperty(this, 'response', { value: JSON.stringify({ code: 0, data: {} }), configurable: true });
                            } catch (error) {}
                            if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
                            if (typeof this.onload === 'function') this.onload();
                            return;
                        }
                        return super.send(body);
                    }

                    this.addEventListener('readystatechange', () => {
                        if (this.readyState !== 4 || this.status !== 200) return;
                        try {
                            const payload = JSON.parse(this.responseText);
                            const result = self.cleanPayload(kind, payload);
                            if (!result.changed) return;
                            self.ruleManager.recordFilter(kind, result.filtered);
                            Object.defineProperty(this, 'responseText', { value: JSON.stringify(result.payload), configurable: true });
                            Object.defineProperty(this, 'response', { value: JSON.stringify(result.payload), configurable: true });
                        } catch (error) {}
                    });

                    return super.send(body);
                }
            };
        }

        createStubResponse() {
            return new Response(JSON.stringify({ code: 0, data: {} }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        async processFetchResponse(response, kind) {
            try {
                const payload = await response.clone().json();
                const result = this.cleanPayload(kind, payload);
                if (!result.changed) return response;
                this.ruleManager.recordFilter(kind, result.filtered);
                return new Response(JSON.stringify(result.payload), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: new Headers(response.headers)
                });
            } catch (error) {
                return response;
            }
        }

        tryBlockUser(mid, username) {
            if (CONFIG.settings.autoBlockUser && mid) {
                this.actionManager.blockUser(mid, username);
            }
        }

        shouldRemoveFeedItem(item) {
            if (!item) return false;
            if (CONFIG.settings.blockAds && ['ad', 'live', 'game_card'].includes(item.goto)) return true;

            const ownerName = item.owner?.name || '';
            if (CONFIG.settings.filterFeed && !this.ruleManager.validate(item.title || '', 'feed')) {
                if (item.owner) this.tryBlockUser(item.owner.mid, ownerName);
                return true;
            }
            if (CONFIG.settings.blockDefaultAvatars && /^bili_\d+$/.test(ownerName)) return true;
            return false;
        }

        filterFeedItems(items) {
            let filtered = 0;
            const nextItems = [];
            for (const item of items) {
                if (this.shouldRemoveFeedItem(item)) {
                    filtered += 1;
                    continue;
                }
                nextItems.push(item);
            }
            return { items: nextItems, filtered };
        }

        filterReplyTree(replies) {
            if (!Array.isArray(replies)) return { replies: [], filtered: 0 };

            let filtered = 0;
            const nextReplies = [];

            for (const reply of replies) {
                if (!reply?.content || !reply?.member) {
                    filtered += 1;
                    continue;
                }

                const message = reply.content.message || '';
                const username = reply.member.uname || '';

                if (CONFIG.settings.filterComments && !this.ruleManager.validate(message, 'comment')) {
                    this.tryBlockUser(reply.member.mid, username);
                    filtered += 1;
                    continue;
                }

                if (CONFIG.settings.blockDefaultAvatars && /^bili_\d+$/.test(username)) {
                    filtered += 1;
                    continue;
                }

                const nested = this.filterReplyTree(reply.replies);
                filtered += nested.filtered;
                nextReplies.push({
                    ...reply,
                    replies: nested.replies
                });
            }

            return { replies: nextReplies, filtered };
        }

        cleanPayload(kind, payload) {
            if (!payload?.data) return { payload, changed: false, filtered: 0 };

            if (kind === 'feed' && Array.isArray(payload.data.item)) {
                const result = this.filterFeedItems(payload.data.item);
                if (!result.filtered) return { payload, changed: false, filtered: 0 };
                return {
                    payload: {
                        ...payload,
                        data: {
                            ...payload.data,
                            item: result.items
                        }
                    },
                    changed: true,
                    filtered: result.filtered
                };
            }

            if (kind === 'comment') {
                const mainReplies = this.filterReplyTree(payload.data.replies);
                const topReplies = this.filterReplyTree(payload.data.top_replies);
                const totalFiltered = mainReplies.filtered + topReplies.filtered;
                if (!totalFiltered) return { payload, changed: false, filtered: 0 };
                return {
                    payload: {
                        ...payload,
                        data: {
                            ...payload.data,
                            replies: mainReplies.replies,
                            top_replies: topReplies.replies
                        }
                    },
                    changed: true,
                    filtered: totalFiltered
                };
            }

            return { payload, changed: false, filtered: 0 };
        }
    }

    class UnlockManager {
        constructor() {
            this.oid = null;
            this.authorId = null;
            this.commentType = null;
            this.replyList = null;
            this.sortType = 3;
            this.offsetStore = {};
            this.replyPool = new Set();
            this.currentPage = 1;
            this._wbiCache = null;
            this.dynamicContextCache = null;
            this.commentAbortController = null;
            this.qualityTimer = null;
            this.qualityAttempts = 0;
            this.qualityPatched = false;
            this.urlCleanup = null;
            this.pageSwitcher = null;
        }

        init() {
            if (document.cookie.includes('DedeUserID')) return;
            if (!this.urlCleanup) this.urlCleanup = Utils.onUrlChange(() => this.refresh());
            this.refresh();
        }

        refresh() {
            if (document.cookie.includes('DedeUserID')) return;
            this.refreshHighQualityUnlock();
            this.refreshGuestComments();
        }

        refreshHighQualityUnlock() {
            this.stopHighQualityUnlock();
            if (!CONFIG.settings.unlockHighQuality) {
                this.cleanQualityConfig();
                return;
            }
            if (!Utils.isVideoLikeUrl()) return;
            Logger.info('✅ 画质解锁');
            this.startHighQualityUnlock();
        }

        refreshGuestComments() {
            this.abortGuestComments();
            if (!CONFIG.settings.unlockGuestComments) return;
            if (!Utils.isSupportedCommentUrl()) return;

            Logger.info('✅ 评论解锁');
            this.commentAbortController = new AbortController();
            this.startCommentUnlock(this.commentAbortController.signal).catch(error => {
                if (error?.name === 'AbortError') return;
                Logger.warn('评论解锁失败', error?.message || String(error));
            });
        }

        abortGuestComments() {
            if (this.commentAbortController) this.commentAbortController.abort();
            this.commentAbortController = null;
            this.replyList = null;
            this.pageSwitcher = null;
        }

        cleanQualityConfig() {
            try {
                localStorage.removeItem('bpx_player_profile');
                localStorage.removeItem('bilibili_player_codec_prefer_type');
            } catch (error) {}
        }

        startHighQualityUnlock() {
            this.applyQualityHooksOnce();
            this.seedQualityConfig();
            this.qualityAttempts = 0;

            const attempt = () => {
                if (!CONFIG.settings.unlockHighQuality || !Utils.isVideoLikeUrl()) {
                    this.stopHighQualityUnlock();
                    return;
                }

                this.qualityAttempts += 1;
                if (this.tryRequestPreferredQuality() || this.qualityAttempts >= 30) {
                    this.stopHighQualityUnlock();
                }
            };

            attempt();
            this.qualityTimer = window.setInterval(attempt, 2000);
        }

        stopHighQualityUnlock() {
            if (this.qualityTimer) clearInterval(this.qualityTimer);
            this.qualityTimer = null;
            this.qualityAttempts = 0;
        }

        applyQualityHooksOnce() {
            if (this.qualityPatched) return;
            this.qualityPatched = true;

            const syncKeys = ['bilibili_player_codec_prefer_type', 'b_miniplayer', 'recommend_auto_play', 'bpx_player_profile'];
            syncKeys.forEach(key => {
                const value = GM_getValue(key);
                if (value != null) localStorage.setItem(key, value);
            });

            const originalSetItem = localStorage.setItem.bind(localStorage);
            localStorage.setItem = function(key, value) {
                let nextValue = value;
                if (key === 'bpx_player_profile') {
                    try {
                        const profile = JSON.parse(value);
                        if (!profile.audioEffect) profile.audioEffect = {};
                        nextValue = JSON.stringify(profile);
                    } catch (error) {}
                }
                return originalSetItem(key, nextValue);
            };

            try {
                if (!Object.getOwnPropertyDescriptor(Object.prototype, 'isViewToday')) {
                    Object.defineProperty(Object.prototype, 'isViewToday', { get: () => true, configurable: true });
                }
                if (!Object.getOwnPropertyDescriptor(Object.prototype, 'isVideoAble')) {
                    Object.defineProperty(Object.prototype, 'isVideoAble', { get: () => true, configurable: true });
                }
            } catch (error) {}

            const originalSetTimeout = unsafeWindow.setTimeout.bind(unsafeWindow);
            unsafeWindow.setTimeout = function(handler, delay, ...args) {
                const nextDelay = delay === 3e4 ? 3e8 : delay;
                return originalSetTimeout(handler, nextDelay, ...args);
            };
        }

        seedQualityConfig() {
            const keys = ['bilibili_player_codec_prefer_type', 'b_miniplayer', 'recommend_auto_play', 'bpx_player_profile'];
            keys.forEach(key => {
                const value = GM_getValue(key);
                if (value != null) localStorage.setItem(key, value);
            });
        }

        tryRequestPreferredQuality() {
            const loginButton = document.querySelector('.bpx-player-toast-confirm-login');
            if (loginButton) loginButton.click();

            const player = unsafeWindow.player;
            if (!player || typeof player.requestQuality !== 'function') return false;

            if (CONFIG.settings.waitHighQualityLoad && typeof player.mediaElement === 'function') {
                const media = player.mediaElement();
                if (media && !media.paused) {
                    media.pause();
                    setTimeout(() => media.play(), 500);
                }
            }

            const qualityMap = { '1080': 80, '720': 64, '480': 32 };
            setTimeout(() => {
                try {
                    player.requestQuality(qualityMap[CONFIG.settings.preferQuality] || 80);
                } catch (error) {}
            }, 300);

            return true;
        }

        async startCommentUnlock(signal) {
            this.resetCommentState();

            const [target, context] = await Promise.all([
                Utils.waitForElement(() => document.querySelector('.comment-container, bili-comments, .comment-wrapper .common'), { signal, timeout: 15000 }),
                this.waitForPageContext(signal)
            ]);

            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            const container = this.ensureCommentContainer(target);
            this.oid = String(context.oid);
            this.commentType = context.commentType;
            this.authorId = Utils.toNumber(context.authorId);
            this.replyList = container.querySelector('.reply-list');

            this.bindSortControls(container, signal);
            await this.showPage(1, { reset: true, signal });
        }

        resetCommentState() {
            this.oid = null;
            this.authorId = null;
            this.commentType = null;
            this.replyList = null;
            this.sortType = 3;
            this.offsetStore = {};
            this.replyPool = new Set();
            this.currentPage = 1;
            this.pageSwitcher = null;
        }

        waitForPageContext(signal) {
            return new Promise((resolve, reject) => {
                let settled = false;
                let observer = null;
                let timer = null;
                let running = false;
                let queued = false;

                const cleanup = () => {
                    if (observer) observer.disconnect();
                    if (timer) clearTimeout(timer);
                    signal?.removeEventListener('abort', onAbort);
                    document.removeEventListener('readystatechange', runCheck);
                    window.removeEventListener('load', runCheck);
                };

                const finish = (value, error = null) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    if (error) reject(error);
                    else resolve(value);
                };

                const onAbort = () => finish(null, new DOMException('Aborted', 'AbortError'));

                const runCheck = async () => {
                    if (settled) return;
                    if (running) {
                        queued = true;
                        return;
                    }

                    running = true;
                    do {
                        queued = false;
                        try {
                            const context = await this.resolvePageContext();
                            if (context?.oid && context?.commentType) {
                                finish(context);
                                break;
                            }
                        } catch (error) {}
                    } while (queued && !settled);
                    running = false;
                };

                if (signal?.aborted) {
                    onAbort();
                    return;
                }

                observer = new MutationObserver(() => runCheck());
                observer.observe(document.documentElement, { childList: true, subtree: true });
                document.addEventListener('readystatechange', runCheck);
                window.addEventListener('load', runCheck);
                signal?.addEventListener('abort', onAbort, { once: true });
                timer = setTimeout(() => finish(null, new Error('Timed out waiting for comment context')), 15000);
                runCheck();
            });
        }

        async resolvePageContext() {
            const href = location.href;
            const global = unsafeWindow;

            if (/https:\/\/www\.bilibili\.com\/video\//.test(href)) {
                const aid = Utils.toNumber(global?.__INITIAL_STATE__?.aid)
                    || Utils.toNumber(global?.__INITIAL_STATE__?.videoData?.aid)
                    || Utils.toNumber(this.extractAidFromUrl(location.pathname));

                return aid ? {
                    oid: aid,
                    commentType: 1,
                    authorId: Utils.toNumber(global?.__INITIAL_STATE__?.upData?.mid)
                } : null;
            }

            if (/https:\/\/www\.bilibili\.com\/bangumi\/play\//.test(href)) {
                let aid = Utils.toNumber(global?.__INITIAL_STATE__?.epInfo?.aid)
                    || Utils.toNumber(global?.__INITIAL_STATE__?.epInfo?.archive?.aid)
                    || Utils.toNumber(global?.__INITIAL_STATE__?.mediaInfo?.aid);

                if (!aid) {
                    const bv = document.querySelector('[class*=mediainfo_mediaDesc] a[href*="video/BV"]')?.textContent?.trim();
                    if (bv?.startsWith('BV')) aid = Utils.toNumber(this.b2a(bv));
                }

                return aid ? {
                    oid: aid,
                    commentType: 1,
                    authorId: Utils.toNumber(global?.__INITIAL_STATE__?.mediaInfo?.up_info?.mid)
                        || Utils.toNumber(document.querySelector('a[class*=upinfo_upLink]')?.href?.split('/').filter(Boolean).pop())
                } : null;
            }

            if (/https:\/\/t\.bilibili\.com\/\d+/.test(href)) {
                const dynamicId = location.pathname.replace(/\//g, '');
                if (!dynamicId) return null;

                if (!this.dynamicContextCache || this.dynamicContextCache.id !== dynamicId) {
                    const detail = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${dynamicId}`).then(res => res.json()).catch(() => null);
                    const item = detail?.data?.item;
                    if (!item) return null;
                    this.dynamicContextCache = { id: dynamicId, item };
                }

                const item = this.dynamicContextCache.item;
                return {
                    oid: item?.basic?.comment_id_str,
                    commentType: Utils.toNumber(item?.basic?.comment_type),
                    authorId: Utils.toNumber(item?.modules?.module_author?.mid)
                };
            }

            if (/https:\/\/www\.bilibili\.com\/read\/cv\d+/.test(href)) {
                const cvid = global?.__INITIAL_STATE__?.cvid;
                return cvid ? {
                    oid: cvid,
                    commentType: 12,
                    authorId: Utils.toNumber(global?.__INITIAL_STATE__?.readInfo?.author?.mid)
                } : null;
            }

            return null;
        }

        extractAidFromUrl(pathname) {
            const videoId = pathname.replace('/video/', '').replace('/', '').trim();
            if (videoId.startsWith('av')) return videoId.slice(2);
            if (videoId.startsWith('BV')) return this.b2a(videoId);
            return null;
        }

        ensureCommentContainer(target) {
            if (target.classList?.contains('comment-container')) return target;

            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
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
                </div>
            `.trim();

            const standard = wrapper.firstElementChild;
            if (!standard) return target;

            if (target.matches?.('bili-comments')) {
                target.replaceWith(standard);
                return standard;
            }

            target.innerHTML = '';
            target.appendChild(standard);
            return standard;
        }

        bindSortControls(container, signal) {
            const nav = container.querySelector('.nav-sort');
            if (!nav || nav.dataset.bsBound === '1') return;
            nav.dataset.bsBound = '1';

            const hot = nav.querySelector('.hot-sort');
            const time = nav.querySelector('.time-sort');

            nav.classList.add('hot');
            nav.classList.remove('time');

            hot?.addEventListener('click', () => {
                if (signal.aborted || this.sortType === 3) return;
                this.sortType = 3;
                nav.classList.add('hot');
                nav.classList.remove('time');
                this.showPage(1, { reset: true, signal });
            });

            time?.addEventListener('click', () => {
                if (signal.aborted || this.sortType === 2) return;
                this.sortType = 2;
                nav.classList.add('time');
                nav.classList.remove('hot');
                this.showPage(1, { reset: true, signal });
            });
        }

        setLoading(text = '正在加载评论...') {
            if (!this.replyList) return;
            this.replyList.innerHTML = `<p style="padding:40px 0;text-align:center;color:#999;">${Utils.escapeHTML(text)}</p>`;
        }

        showEmpty(text = '没有更多评论') {
            if (!this.replyList) return;
            this.replyList.innerHTML = `<p style="padding:80px 0;text-align:center;color:#999;">${Utils.escapeHTML(text)}</p>`;
        }

        async showPage(pageNum, { reset = false, signal = null } = {}) {
            if (!this.replyList) return;
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            if (reset) {
                this.offsetStore = { 1: '{"offset":""}' };
                this.replyPool.clear();
                this.currentPage = 1;
            }

            this.setLoading();
            const response = await this.getPaginationData(pageNum, signal);
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            if (response.code !== 0) {
                this.showEmpty(`无法获取评论或评论区已关闭 (Code: ${response.code})`);
                this.removePageSwitcher();
                return;
            }

            const data = response.data || {};
            const hasTop = pageNum === 1 && Array.isArray(data.top_replies) && data.top_replies.length > 0;
            const hasReplies = Array.isArray(data.replies) && data.replies.length > 0;

            if (!hasTop && !hasReplies) {
                if (pageNum === 1) {
                    this.showEmpty('没有更多评论');
                    this.removePageSwitcher();
                } else {
                    this.offsetStore[pageNum] = 'no-next-offset';
                    this.updatePageSwitcher(false);
                    Toast.info('没有更多了');
                }
                return;
            }

            this.currentPage = pageNum;
            this.renderPageData(pageNum, data);
            this.ensurePageSwitcher();
            this.updatePageSwitcher(this.offsetStore[pageNum + 1] !== 'no-next-offset');
            const container = document.querySelector('.comment-container');
            if (container) document.documentElement.scrollTop = container.offsetTop - 60;
        }

        renderPageData(pageNum, data) {
            if (!this.replyList) return;
            this.replyPool.clear();

            const totalCount = document.querySelector('.comment-container .reply-header .total-reply');
            if (totalCount) totalCount.textContent = data?.cursor?.all_count || 0;

            const fragment = document.createDocumentFragment();

            if (pageNum === 1 && Array.isArray(data.top_replies) && data.top_replies.length > 0) {
                const topReply = this.createReplyElement(data.top_replies[0], true);
                if (topReply) fragment.appendChild(topReply);
            }

            (data.replies || []).forEach(reply => {
                const element = this.createReplyElement(reply, false);
                if (element) fragment.appendChild(element);
            });

            this.replyList.innerHTML = '';
            this.replyList.appendChild(fragment);
        }

        ensurePageSwitcher() {
            const wrap = document.querySelector('.comment-container .reply-warp');
            if (!wrap) return;

            if (this.pageSwitcher?.root?.isConnected) return;

            const root = document.createElement('div');
            root.className = 'page-switcher';
            root.innerHTML = `
                <div class="page-switcher-wrapper">
                    <button type="button" class="page-switcher-btn page-switcher-prev-btn">上一页</button>
                    <span class="page-switcher-current-page">1</span>
                    <button type="button" class="page-switcher-btn page-switcher-next-btn">下一页</button>
                </div>
            `;
            wrap.appendChild(root);

            const prev = root.querySelector('.page-switcher-prev-btn');
            const next = root.querySelector('.page-switcher-next-btn');
            const current = root.querySelector('.page-switcher-current-page');

            prev?.addEventListener('click', () => {
                if (this.currentPage <= 1) return;
                this.showPage(this.currentPage - 1, { reset: false, signal: this.commentAbortController?.signal || null });
            });

            next?.addEventListener('click', () => {
                this.showPage(this.currentPage + 1, { reset: false, signal: this.commentAbortController?.signal || null });
            });

            this.pageSwitcher = { root, prev, next, current };
        }

        updatePageSwitcher(hasNextPage) {
            if (!this.pageSwitcher) return;
            this.pageSwitcher.current.textContent = String(this.currentPage);
            this.pageSwitcher.prev.disabled = this.currentPage <= 1;
            this.pageSwitcher.next.disabled = !hasNextPage;
        }

        removePageSwitcher() {
            this.pageSwitcher?.root?.remove();
            this.pageSwitcher = null;
        }

        async getPaginationData(pageNum, signal) {
            const params = {
                oid: this.oid,
                type: this.commentType,
                mode: this.sortType,
                wts: Math.floor(Date.now() / 1000)
            };

            params.pagination_str = this.offsetStore[pageNum] || '{"offset":""}';
            if (params.pagination_str === 'no-next-offset') {
                return { code: 0, data: { replies: [] } };
            }

            const query = await this.getWbiQueryString(params, signal);
            const response = await fetch(`https://api.bilibili.com/x/v2/reply/wbi/main?${query}`, { signal }).then(res => res.json());
            if (response.code === 0) {
                const nextOffset = response.data?.cursor?.pagination_reply?.next_offset;
                this.offsetStore[pageNum + 1] = nextOffset ? `{"offset":"${nextOffset}"}` : 'no-next-offset';
            }
            return response;
        }

        async getWbiQueryString(params, signal) {
            if (!this._wbiCache || Date.now() - this._wbiCache.time > 5 * 60 * 1000) {
                const nav = await fetch('https://api.bilibili.com/x/web-interface/nav', { signal }).then(res => res.json());
                const imgUrl = nav?.data?.wbi_img?.img_url || '';
                const subUrl = nav?.data?.wbi_img?.sub_url || '';
                const imgKey = imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.'));
                const subKey = subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.'));
                const mixinKey = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
                    .map(index => (imgKey + subKey)[index])
                    .join('')
                    .slice(0, 32);
                this._wbiCache = { mixinKey, time: Date.now() };
            }

            const query = Object.keys(params).sort().map(key => {
                const value = String(params[key]).replace(/[!'()*]/g, '');
                return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            }).join('&');

            return `${query}&w_rid=${SparkMD5.hash(query + this._wbiCache.mixinKey)}`;
        }

        createReplyElement(data, isTop) {
            if (!data?.rpid_str || !data?.member || !data?.content) return null;
            if (this.replyPool.has(data.rpid_str)) return null;
            this.replyPool.add(data.rpid_str);

            const member = data.member;
            const vipColor = member.vip?.nickname_color || '#61666d';
            const level = Utils.toNumber(member.level_info?.current_level, 0);
            const memberId = Utils.toNumber(member.mid, Utils.toNumber(data.mid));
            const isAuthor = this.authorId != null && memberId === this.authorId;
            const pictures = Array.isArray(data.content.pictures) ? data.content.pictures.filter(item => item?.img_src) : [];
            const pendantImage = CONFIG.settings.enableFanMedal ? member.pendant?.image : '';
            const safeUserName = Utils.escapeHTML(member.uname || 'B站用户');
            const safeAvatar = Utils.escapeHTML(member.avatar || '');

            const pendantHTML = pendantImage
                ? `<div class="bili-avatar-pendent-dom"><img src="${Utils.escapeHTML(pendantImage)}"></div>`
                : '';

            const fansDetail = CONFIG.settings.enableFanMedal ? member.fans_detail : null;
            const medalHTML = fansDetail ? `
                <div class="fan-medal ${fansDetail.guard_icon ? 'fan-medal-with-guard-icon' : ''}">
                    <img class="fan-medal-icon" src="${Utils.escapeHTML(fansDetail.guard_icon || 'https://i0.hdslb.com/bfs/live/82d48274d0d84e2c328c4353c38def6eaf5de27a.png')}" style="${fansDetail.guard_icon ? '' : 'display:none'}">
                    <div class="fan-medal-name">${Utils.escapeHTML(fansDetail.medal_name || '')}</div>
                    <div class="fan-medal-level">${Utils.escapeHTML(fansDetail.level || '')}</div>
                </div>
            ` : '';

            const imagesHTML = pictures.length ? `
                <div class="preview-image-container" style="display:flex;flex-wrap:wrap;gap:4px;margin:8px 0;">
                    ${pictures.map(item => `<div style="cursor:zoom-in"><img src="${Utils.escapeHTML(item.img_src)}" style="border-radius:4px;width:96px;height:96px;object-fit:cover;"></div>`).join('')}
                </div>
            ` : '';

            const notePrefix = CONFIG.settings.enableNotePrefix && pictures.length ? `
                <span class="note-prefix">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25ZM3.5 6.25a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm.75 2.25h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z"></path></svg>
                    笔记
                </span>
            ` : '';

            const element = document.createElement('div');
            element.className = 'reply-item';
            element.innerHTML = `
                <div class="root-reply-container">
                    <div class="root-reply-avatar">
                        <div class="avatar">
                            <div class="bili-avatar">
                                <img class="bili-avatar-img" src="${safeAvatar}">
                                ${pendantHTML}
                            </div>
                        </div>
                    </div>
                    <div class="content-warp">
                        <div class="user-info">
                            <a class="user-name" target="_blank" href="//space.bilibili.com/${Utils.escapeHTML(member.mid || '')}" style="color:${Utils.escapeHTML(vipColor)}">${safeUserName}</a>
                            <span style="height:16px;line-height:16px;padding:0 2px;margin-right:4px;font-size:12px;color:white;border-radius:2px;background-color:${this.getLevelColor(level)}">LV${level}</span>
                            ${isAuthor ? '<span style="font-size:12px;background:#FF6699;color:white;padding:0 4px;border-radius:2px;margin-right:4px;">UP</span>' : ''}
                            ${medalHTML}
                        </div>
                        <div class="root-reply">
                            <span class="reply-content-container root-reply">
                                <span class="reply-content">${isTop ? '<span style="color:#FF6699;margin-right:4px;font-weight:bold;">[置顶]</span>' : ''}${notePrefix}${this.processContent(data.content.message || '')}</span>
                            </span>
                            ${imagesHTML}
                            <div class="reply-info">
                                <span class="reply-time" style="margin-right:20px;">${this.formatTime(data.ctime)}</span>
                                <span class="reply-like">👍 ${Utils.escapeHTML(data.like || 0)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="sub-reply-container"><div class="sub-reply-list">${this.renderSubReplies(data.replies)}</div></div>
            `;

            if (pictures.length) {
                const preview = element.querySelector('.preview-image-container');
                if (preview) new Viewer(preview, { title: false, toolbar: false });
            }

            return element;
        }

        renderSubReplies(replies) {
            if (!Array.isArray(replies) || !replies.length) return '';
            return replies.map(reply => {
                if (!reply?.member || !reply?.content) return '';
                const member = reply.member;
                const memberId = Utils.toNumber(member.mid, Utils.toNumber(reply.mid));
                const isAuthor = this.authorId != null && memberId === this.authorId;
                return `
                    <div class="sub-reply-item">
                        <div class="sub-reply-avatar">
                            <img src="${Utils.escapeHTML(member.avatar || '')}">
                        </div>
                        <div class="sub-reply-content-box">
                            <div style="display:inline-block;margin-bottom:4px;">
                                <a class="sub-user-name" target="_blank" href="//space.bilibili.com/${Utils.escapeHTML(member.mid || '')}" style="color:${Utils.escapeHTML(member.vip?.nickname_color || '#61666d')};">${Utils.escapeHTML(member.uname || 'B站用户')}</a>
                                ${isAuthor ? '<span style="font-size:12px;background:#FF6699;color:white;padding:0 2px;border-radius:2px;margin-right:4px;transform:scale(0.85);display:inline-block;">UP</span>' : ''}
                                <span style="font-size:13px;color:#18191C;">${this.processContent(reply.content.message || '')}</span>
                            </div>
                            <div class="sub-reply-info">${this.formatTime(reply.ctime)}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        processContent(message) {
            const escaped = Utils.escapeHTML(message).replace(/\n/g, '<br>');
            return escaped.replace(/\[(.*?)\]/g, match => `<span style="color:#666;">${match}</span>`);
        }

        formatTime(timestamp) {
            const date = new Date((timestamp || 0) * 1000);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hour = String(date.getHours()).padStart(2, '0');
            const minute = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day} ${hour}:${minute}`;
        }

        getLevelColor(level) {
            return ['#C0C0C0', '#BBBBBB', '#8BD29B', '#7BCDEF', '#FEBB8B', '#EE672A', '#F04C49'][level] || '#C0C0C0';
        }

        b2a(bvid) {
            const XOR = 23442827791579n;
            const MASK = 2251799813685247n;
            const BASE = 58n;
            const TABLE = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
            const INDEXES = [0, 1, 2, 9, 7, 5, 6, 4, 8, 3, 10, 11];
            let value = 0n;

            for (let i = 3; i < 12; i += 1) {
                value = value * BASE + BigInt(TABLE.indexOf(bvid[INDEXES[i]]));
            }

            return String((value & MASK) ^ XOR);
        }
    }

    class UIManager {
        constructor({ ruleManager, cssInjector, unlockManager, danmakuCleaner, smartCleaner }) {
            this.ruleManager = ruleManager;
            this.cssInjector = cssInjector;
            this.unlockManager = unlockManager;
            this.danmakuCleaner = danmakuCleaner;
            this.smartCleaner = smartCleaner;
            this.root = null;
            this.shadow = null;
            this.isOpen = false;
        }

        async init() {
            GM_registerMenuCommand('⚡ 强制重置 UI', () => {
                if (this.root) this.root.remove();
                this.renderUI();
                Toast.success('UI 已重置');
            });

            await Utils.waitForBody();
            if (!document.getElementById('bili-shield-root')) this.renderUI();
            window._biliShieldUpdateStats = () => this.renderStats();
            window._biliShieldUpdateLogs = () => this.renderLogs();
        }

        renderUI() {
            this.root = document.createElement('div');
            this.root.id = 'bili-shield-root';
            this.root.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;';
            document.body.appendChild(this.root);

            this.shadow = this.root.attachShadow({ mode: 'open' });
            this.injectStyles();
            this.render();
            this.bindEvents();
        }

        injectStyles() {
            this.shadow.innerHTML += `
                <style>
                    :host { --pink:#FF6699; --pink-light:#FFEBF1; --blue:#00AEEC; --orange:#F4A460; --text:#555; --bg:rgba(255,255,255,0.95); }
                    * { box-sizing:border-box; font-family:"HarmonyOS Sans","PingFang SC","Microsoft YaHei",sans-serif; }
                    .entry-btn { position:fixed; bottom:80px; right:24px; width:56px; height:56px; background:radial-gradient(circle at 30% 30%, #FFD700, #F4A460); border-radius:50%; box-shadow:0 6px 16px rgba(244,164,96,0.4), inset 0 2px 4px rgba(255,255,255,0.5); cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:10000; transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1); animation:float 3s ease-in-out infinite; border:2px solid #FFF; }
                    .entry-btn:hover { transform:scale(1.15) rotate(360deg); box-shadow:0 12px 28px rgba(244,164,96,0.6); }
                    .entry-btn::after { content:'⚡'; font-size:26px; color:#FFF; text-shadow:0 1px 2px rgba(0,0,0,0.2); }
                    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
                    .panel { position:fixed; bottom:150px; right:24px; width:360px; height:560px; background:var(--bg); backdrop-filter:blur(24px) saturate(180%); border-radius:24px; box-shadow:0 16px 48px rgba(0,0,0,0.15); display:flex; flex-direction:column; opacity:0; pointer-events:none; transform:scale(0.8) translateY(40px); transform-origin:bottom right; transition:all 0.5s cubic-bezier(0.34,1.56,0.64,1); overflow:hidden; border:2px solid #FFF; background-image:radial-gradient(#FF669933 2px, transparent 2px); background-size:20px 20px; }
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
                    .content::-webkit-scrollbar { width:4px; }
                    .content::-webkit-scrollbar-thumb { background:#FFD1E1; border-radius:10px; }
                    .view { display:none; animation:fadeIn 0.3s ease-out; position:relative; z-index:2; }
                    .view.active { display:block; }
                    .stats-card { background:linear-gradient(135deg,#7FD6F5,#00AEEC); border-radius:16px; padding:20px; color:white; margin-bottom:16px; text-align:center; box-shadow:0 8px 20px rgba(0,174,236,0.3); position:relative; overflow:hidden; transition:transform 0.3s; }
                    .stats-card:hover { transform:scale(1.02); }
                    .stats-num { font-size:36px; font-weight:900; margin-bottom:4px; text-shadow:0 2px 8px rgba(0,0,0,0.15); letter-spacing:-1px; }
                    .stats-label { font-size:13px; font-weight:500; opacity:0.9; background:rgba(0,0,0,0.1); padding:4px 12px; border-radius:20px; display:inline-block; }
                    .stats-sub { margin-top:8px; font-size:11px; opacity:0.95; }
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
                    .log-box { font-family:"Consolas",monospace; font-size:11px; color:#666; padding:10px; line-height:1.6; background:rgba(255,255,255,0.5); border-radius:12px; border:1px solid #EEE; }
                    .dev-section { margin-bottom:12px; padding:10px 12px; background:rgba(255,255,255,0.72); border:1px solid #EEE; border-radius:12px; }
                    .dev-title { font-weight:700; color:#555; margin-bottom:8px; }
                    .dev-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
                    .dev-chip { padding:8px 10px; border-radius:10px; background:#F7F9FB; border:1px solid #EDF1F5; }
                    .dev-chip strong { display:block; color:#333; font-size:12px; }
                    .dev-chip span { color:#888; font-size:11px; }
                    .dev-list { display:flex; flex-direction:column; gap:6px; }
                    .dev-item { padding:8px 10px; border-radius:10px; background:#F7F9FB; border:1px solid #EDF1F5; word-break:break-word; }
                    .dev-meta { color:#999; font-size:10px; margin-bottom:2px; }
                    .log-line { margin-bottom:6px; border-bottom:1px solid #E3E5E7; padding-bottom:4px; word-break:break-word; }
                    @keyframes fadeIn { from { opacity:0; transform:translateY(15px); } to { opacity:1; transform:translateY(0); } }
                </style>
            `;
        }

        render() {
            const closeIcon = '<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:white;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
            this.shadow.innerHTML += `
                <div class="entry-btn" id="toggleBtn" title="超电磁炮准备就绪"></div>
                <div class="panel" id="mainPanel">
                    <div class="header"><div class="title">⚡ 全能护盾 <span class="badge">V${SCRIPT_VERSION}</span></div><div class="close-btn" id="closePanel">${closeIcon}</div></div>
                    <div class="tabs">
                        <div class="tab active" data-target="home">通用</div>
                        <div class="tab" data-target="shield">净化</div>
                        <div class="tab" data-target="unlock">解锁</div>
                        <div class="tab" data-target="dev">日志</div>
                    </div>
                    <div class="content">
                        <div class="view active" id="home">
                            <div class="stats-card">
                                <div class="stats-num" id="keywordCount">...</div>
                                <div class="stats-label">御坂网络·规则覆盖中</div>
                                <div class="stats-sub" id="regexCount">正则规则 ...</div>
                            </div>
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
                            <div class="setting-item"><span class="label">🎨 偏好画质</span><select id="sel_preferQuality"><option value="1080">1080P</option><option value="720">720P</option><option value="480">480P</option></select></div>
                            <div class="setting-item"><span class="label">👀 未登录看评论</span><label class="switch"><input type="checkbox" id="sw_unlockGuestComments"><span class="slider"></span></label></div>
                            <div class="setting-item"><span class="label">🏅 显示粉丝勋章</span><label class="switch"><input type="checkbox" id="sw_enableFanMedal"><span class="slider"></span></label></div>
                            <div class="setting-item"><span class="label">📝 显示笔记前缀</span><label class="switch"><input type="checkbox" id="sw_enableNotePrefix"><span class="slider"></span></label></div>
                        </div>
                        <div class="view" id="dev"><div class="log-box" id="logContainer"></div></div>
                    </div>
                </div>
            `;
            this.renderStats();
        }

        bindEvents() {
            const $ = selector => this.shadow.querySelector(selector);
            const $$ = selector => this.shadow.querySelectorAll(selector);

            $('#toggleBtn').onclick = () => {
                this.isOpen = !this.isOpen;
                $('#mainPanel').classList.toggle('open', this.isOpen);
            };
            $('#closePanel').onclick = () => {
                this.isOpen = false;
                $('#mainPanel').classList.remove('open');
            };

            $$('.tab').forEach(tab => {
                tab.onclick = () => {
                    $$('.tab').forEach(node => node.classList.remove('active'));
                    $$('.view').forEach(node => node.classList.remove('active'));
                    tab.classList.add('active');
                    $(`#${tab.dataset.target}`).classList.add('active');
                    if (tab.dataset.target === 'dev') this.renderLogs();
                };
            });

            $('#btnUpdate').onclick = () => {
                const button = $('#btnUpdate');
                button.innerText = '正在连接御坂网络...';
                this.ruleManager.forceUpdate();
                setTimeout(() => { button.innerText = '立即更新云端词库'; }, 2000);
            };

            const bind = (id, key) => {
                const element = $(`#${id}`);
                if (!element) return;

                if (element.type === 'checkbox') {
                    if (key === 'devMode') {
                        element.checked = STATE.isDevMode;
                        element.onchange = event => {
                            STATE.isDevMode = event.target.checked;
                            GM_setValue('cfg_dev_mode', event.target.checked);
                            if (!STATE.isDevMode) STATE.debug.recentMatches = [];
                            this.renderLogs();
                        };
                        return;
                    }

                    element.checked = CONFIG.settings[key];
                    element.onchange = event => {
                        CONFIG.settings[key] = event.target.checked;
                        GM_setValue(`cfg_${key}`, event.target.checked);

                        if (['blockAds', 'pinkHeader', 'hideCarousel', 'hideFloorCard', 'hideLeftLocEntry', 'blockLoginPopups'].includes(key)) {
                            this.cssInjector.applyStyles();
                        }
                        if (['unlockGuestComments', 'enableFanMedal', 'enableNotePrefix'].includes(key)) {
                            this.cssInjector.injectUnlockStyles();
                        }
                        if (key === 'blockNews') {
                            this.ruleManager.rebuildFromCurrentSource();
                        }
                        if (key === 'unlockHighQuality' && !event.target.checked) {
                            localStorage.removeItem('bpx_player_profile');
                            localStorage.removeItem('bilibili_player_codec_prefer_type');
                            Toast.info('已清除画质锁定缓存');
                        }
                        if (key === 'filterDanmaku') this.danmakuCleaner?.refresh();
                        if (key === 'blockAds') this.smartCleaner?.refresh();
                        if (['unlockGuestComments', 'unlockHighQuality', 'waitHighQualityLoad'].includes(key)) this.unlockManager?.refresh();
                        if (key === 'enableFanMedal' || key === 'enableNotePrefix') this.unlockManager?.refreshGuestComments();
                        this.renderStats();
                        this.renderLogs();
                    };
                } else {
                    element.value = CONFIG.settings[key];
                    element.onchange = event => {
                        CONFIG.settings[key] = event.target.value;
                        GM_setValue(`cfg_${key}`, event.target.value);
                        this.unlockManager?.refreshHighQualityUnlock();
                    };
                }
            };

            ['pinkHeader', 'hideCarousel', 'hideFloorCard', 'hideLeftLocEntry', 'filterFeed', 'filterComments', 'blockAds', 'blockDefaultAvatars', 'devMode', 'unlockHighQuality', 'waitHighQualityLoad', 'unlockGuestComments', 'enableFanMedal', 'enableNotePrefix', 'autoBlockUser', 'blockNews', 'blockLoginPopups', 'filterDanmaku'].forEach(key => bind(`sw_${key}`, key));
            bind('sel_preferQuality', 'preferQuality');
        }

        renderStats() {
            if (!this.shadow) return;
            const summary = this.ruleManager.getSummary();
            const keywordCount = this.shadow.querySelector('#keywordCount');
            const regexCount = this.shadow.querySelector('#regexCount');
            if (keywordCount) keywordCount.textContent = summary.total;
            if (regexCount) regexCount.textContent = `正则规则 ${summary.blackRegex + summary.whiteRegex} 条 / 无效 ${summary.invalidRegex} 条`;
        }

        renderLogs() {
            if (!this.shadow) return;
            const container = this.shadow.querySelector('#logContainer');
            if (!container) return;

            if (!STATE.isDevMode) {
                container.innerHTML = '<div style="padding:40px;text-align:center;color:#999">请开启开发者模式<br>(✧ω✧)</div>';
                return;
            }

            const summary = this.ruleManager.getSummary();
            const invalidRules = this.ruleManager.getInvalidRules();
            const matches = this.ruleManager.getRecentMatches();
            const logLines = STATE.logs.slice().reverse().map(log => `
                <div class="log-line">
                    <span style="color:#999;font-size:11px">[${Utils.escapeHTML(log.time)}]</span>
                    <b style="color:${log.type === 'RAILGUN' ? '#FF6699' : '#00AEEC'};margin:0 4px">${Utils.escapeHTML(log.type)}</b>
                    ${Utils.escapeHTML(log.msg)}
                </div>
            `).join('');

            const invalidLines = invalidRules.length ? invalidRules.map(rule => `
                <div class="dev-item">
                    <div class="dev-meta">${Utils.escapeHTML(rule.source)} · ${Utils.escapeHTML(rule.error || 'compile error')}</div>
                    <div>${Utils.escapeHTML(rule.raw)}</div>
                </div>
            `).join('') : '<div class="dev-item">无</div>';

            const matchLines = matches.length ? matches.map(match => `
                <div class="dev-item">
                    <div class="dev-meta">${Utils.escapeHTML(match.time)} · ${Utils.escapeHTML(match.context)} · ${Utils.escapeHTML(match.listType)} · ${Utils.escapeHTML(match.kind)}</div>
                    <div><strong>${Utils.escapeHTML(match.rule)}</strong></div>
                    <div>${Utils.escapeHTML(match.preview)}</div>
                </div>
            `).join('') : '<div class="dev-item">暂无命中记录</div>';

            container.innerHTML = `
                <div class="dev-section">
                    <div class="dev-title">规则概览</div>
                    <div class="dev-grid">
                        <div class="dev-chip"><strong>${summary.blackStrings}</strong><span>黑名单字符串</span></div>
                        <div class="dev-chip"><strong>${summary.blackRegex}</strong><span>黑名单正则</span></div>
                        <div class="dev-chip"><strong>${summary.whiteStrings}</strong><span>白名单字符串</span></div>
                        <div class="dev-chip"><strong>${summary.whiteRegex}</strong><span>白名单正则</span></div>
                    </div>
                </div>
                <div class="dev-section">
                    <div class="dev-title">运行统计</div>
                    <div class="dev-grid">
                        <div class="dev-chip"><strong>${STATE.stats.feedFiltered}</strong><span>推荐流过滤</span></div>
                        <div class="dev-chip"><strong>${STATE.stats.commentFiltered}</strong><span>评论过滤</span></div>
                        <div class="dev-chip"><strong>${STATE.stats.danmakuFiltered}</strong><span>弹幕过滤</span></div>
                        <div class="dev-chip"><strong>${STATE.stats.adHidden}</strong><span>广告隐藏</span></div>
                    </div>
                </div>
                <div class="dev-section">
                    <div class="dev-title">无效正则</div>
                    <div class="dev-list">${invalidLines}</div>
                </div>
                <div class="dev-section">
                    <div class="dev-title">最近命中</div>
                    <div class="dev-list">${matchLines}</div>
                </div>
                <div class="dev-section">
                    <div class="dev-title">运行日志</div>
                    ${logLines || '<div class="dev-item">暂无日志</div>'}
                </div>
            `;
        }
    }

    async function safeInit(name, fn) {
        try {
            await fn();
        } catch (error) {
            Logger.warn(`${name} 启动失败`, error?.message || String(error));
        }
    }

    function main() {
        Logger.suppressErrors();

        const cssInjector = new CSSInjector();
        cssInjector.init();

        const ruleManager = new RuleManager();
        ruleManager.init();

        const smartCleaner = new SmartCleaner(ruleManager);
        const danmakuCleaner = new DanmakuCleaner(ruleManager);
        const networkInterceptor = new NetworkInterceptor(ruleManager);
        const unlockManager = new UnlockManager();
        const uiManager = new UIManager({
            ruleManager,
            cssInjector,
            unlockManager,
            danmakuCleaner,
            smartCleaner
        });

        void safeInit('网络拦截', () => networkInterceptor.init());
        void safeInit('广告清理', () => smartCleaner.init());
        void safeInit('弹幕拦截', () => danmakuCleaner.init());
        void safeInit('功能解锁', () => unlockManager.init());
        void safeInit('UI界面', () => uiManager.init());

        Logger.info(`全能护盾已启动 - Railgun Ultimate ${SCRIPT_VERSION}`);
    }

    main();
})();
