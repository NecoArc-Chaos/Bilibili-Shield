// ==UserScript==
// @name         Bilibili 全能护盾
// @namespace    https://github.com/Sakurairinaqwq/Bilibili-Shield
// @version      1.1.0
// @author       Sakurairinaqwq
// @description  B站内容净化工具。支持API拦截、DOM元素隐藏、评论区过滤及营销号屏蔽。兼容Bilibili-Old。
// @match        https://www.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // ========================================================================
    // Global Error Suppression & Polyfills
    // Prevent the page from crashing when blocking tracking scripts.
    // ========================================================================
    try {
        const noop = () => {};

        // Mock missing global reporting functions
        const MOCK_GLOBALS = [
            'reportfs', 'reportObserver', 'reportMsg', 'rec_rp',
            '__f__', 'biliReport', 'Reflect'
        ];

        MOCK_GLOBALS.forEach(name => {
            if (typeof unsafeWindow[name] === 'undefined') {
                Object.defineProperty(unsafeWindow, name, {
                    value: noop,
                    writable: true
                });
            }
        });

        // Specific mock for reportObserver object
        if (!unsafeWindow.reportObserver) {
            unsafeWindow.reportObserver = { forceCommit: noop };
        }
    } catch (e) {
        // Ignore errors during mocking
    }

    // Suppress console errors caused by request blocking
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    console.error = function(...args) {
        const msg = args.map(String).join(' ');
        // Filter out known errors related to blocking
        if (
            msg.includes("reportfs") ||
            msg.includes("undefined") ||
            msg.includes("reading 'length'") ||
            msg.includes("reading 'code'") ||
            msg.includes("BLOCKED") ||
            msg.includes("report") ||
            msg.includes("mismatches") ||
            msg.includes("403") ||
            msg.includes("HierarchyRequestError")
        ) {
            return;
        }
        originalConsoleError.apply(console, args);
    };

    console.warn = function(...args) {
        const msg = args.map(String).join(' ');
        // Suppress Vue hydration warnings caused by DOM modification
        if (msg.includes("Hydration")) return;
        originalConsoleWarn.apply(console, args);
    };

    // ========================================================================
    // Configuration & Settings
    // ========================================================================
    const DEFAULT_CONFIG = {
        debug: true,
        enableOldStyle: false,    // Pink header style
        enableOldCompat: false,   // Compatibility mode for Bilibili-Old
        cleanHomepageDOM: true,   // Hide homepage floors
        autoBlockMCN: true,       // Block marketing accounts
        autoBlockMarketing: true, // Block course selling
        autoBlockAds: true,       // Block ads
        autoBlockToxic: true,     // Block toxic keywords
        blockZone: true,          // Block specific zones (Variety/Entertainment)
        blockInitial: true,       // Block uninitialized accounts (bili_xxx)
        blockNetwork: true,       // Network request blocking
        blockAtOnly: true         // Block comments containing only @mentions
    };

    const CONFIG = {
        ...DEFAULT_CONFIG,
        ...{
            enableOldStyle: GM_getValue('enableOldStyle', DEFAULT_CONFIG.enableOldStyle),
            enableOldCompat: GM_getValue('enableOldCompat', DEFAULT_CONFIG.enableOldCompat),
            cleanHomepageDOM: GM_getValue('cleanHomepageDOM', DEFAULT_CONFIG.cleanHomepageDOM),
            autoBlockMCN: GM_getValue('autoBlockMCN', DEFAULT_CONFIG.autoBlockMCN),
            autoBlockMarketing: GM_getValue('autoBlockMarketing', DEFAULT_CONFIG.autoBlockMarketing),
            autoBlockAds: GM_getValue('autoBlockAds', DEFAULT_CONFIG.autoBlockAds),
            autoBlockToxic: GM_getValue('autoBlockToxic', DEFAULT_CONFIG.autoBlockToxic),
            blockZone: GM_getValue('blockZone', DEFAULT_CONFIG.blockZone),
            blockInitial: GM_getValue('blockInitial', DEFAULT_CONFIG.blockInitial),
            blockNetwork: GM_getValue('blockNetwork', DEFAULT_CONFIG.blockNetwork),
            blockAtOnly: GM_getValue('blockAtOnly', DEFAULT_CONFIG.blockAtOnly),
        }
    };

    function saveSetting(key, value) {
        CONFIG[key] = value;
        GM_setValue(key, value);
        log(`Setting updated: ${key} -> ${value}`, "#00a1d6");
        updateStatusText("Saved", "lime");

        // Apply immediate effects
        if (key === 'cleanHomepageDOM' && value) hideFloors();
        if (key === 'enableOldStyle') applyOldStyle(value);
        if (key === 'enableOldCompat') setTimeout(() => location.reload(), 500);
    }

    // ========================================================================
    // Rule Definitions
    // ========================================================================

    // Whitelist: Always allow these keywords
    const WHITE_LIST = [
        "谢谢", "加油", "求bgm", "求BGM", "好听", "三连", "下次", "教程", "辛苦", "借吉言",
        "互关", "好人", "大神", "可爱", "指路", "课代表", "快乐",
        "罕见病", "不罕见", "罕见气象", "罕见生物", "罕见奇观", "比较罕见",
        "间谍过家家", "间谍片", "间谍电影", "间谍游戏", "双重间谍",
        "原神攻略", "剧情", "角色", "深渊", "圣遗物", "卡池", "pv", "PV", "联动", "二创",
        "无畏契约", "音乐", "约定", "第一人称", "世界第一", "公开课", "考研", "数学", "笔记",
        "朱迪", "一群", "群众", "群聊", "群主", "人群", "批评", "批准", "批量", "大米", "玉米", "厘米", "纳米", "毫米", "赢家", "双赢", "躺赢",
        "网络安全科普", "反诈", "防骗", "硬核", "极客",
        "民航", "客机", "波音", "空客", "模拟飞行", "塔台", "空中浩劫", "飞行员", "机场", "舱内", "硬核航空", "迫降", "首飞", "试飞", "航空",
        "东京", "旅游", "寺庙", "神社", "雷门", "浅草寺"
    ];

    // Regex patterns for blocking MCN/Marketing accounts
    const MCN_PATTERNS = [
        /.*八方网域.*/, /.*小白帽.*/, /.*黑客.*/, /.*渗透.*/, /.*攻防.*/, /.*脚本.*/,
        /.*讲故事.*/, /.*文旅.*/, /.*哈基米.*/,
        /^bili_\d+$/,
        /.*新闻$/, /.*帮忙$/, /.*视讯$/, /.*要闻$/, /.*都市报$/, /.*日报$/, /.*晚报$/, /.*早报$/, /.*商报$/, /.*快报$/,
        /^环球.*/, /.*时报$/, /.*财经$/, /.*视频$/, /.*资讯$/, /.*观察$/, /.*在线$/, /.*TV$/, /.*卫视$/, /.*广播.*/,
        /.*融媒.*/, /.*发布$/, /.*官方$/, /.*网$/, /.*看点$/
    ];

    // Block by API identity fields (tname, goto, uri)
    const BLOCK_IDENTITY = [
        "综艺", "课堂", "推广", "cheese", "cm_ad", "ad", "live", "game", "娱乐",
        "纪录片", "电影", "电视剧", "番剧", "国创", "pgc", "ogv", "bangumi", "cinema"
    ];

    // Target floor titles to remove from homepage
    const TARGET_FLOORS = [
        "综艺", "课堂", "推广", "直播", "娱乐", "纪录片", "电影", "电视剧", "番剧", "国创", "游戏"
    ];

    // Keywords to ignore when blocking titles
    const TITLE_EXEMPTIONS = [
        "第一", "前排", "吃瓜", "纯路人", "只有我", "不喜勿喷", "甚至不愿", "震惊", "曝光"
    ];

    // Patterns for course selling
    const MARKETING_PATTERNS = [
        /^【.*(?:送|领|免费|加V|加v|变现|搞钱|副业|日入|月入).*】/,
        /^【.*(?:资料|课程|训练营|实操|速成).*】/,
        /PS异闻录/, /萌新系统入门/, /入门到入狱/, /接单/, /渗透测试/, /Kali/
    ];

    // Keyword categories
    const KEYWORDS = {
        ad: ["看我动态", "置顶", "加v", "加V", "加q", "加Q", "薇信", "威信", "企鹅", "加群", "入群", "建群", "Q群", "裙号", "日结", "赚米", "收米", "搞米", "兼职", "拼兮兮", "拼夕夕", "私我", "点击头像", "同城"],
        politics: ["间谍", "特务", "渗透", "美帝", "老美", "阿美", "昂撒", "北约", "犹太", "以色列", "乌贼", "毛子", "大毛", "二毛", "小日本", "脚盆鸡", "鬼子", "棒子", "偷国", "阿三", "湾湾", "蛙", "呆蛙", "1450", "ww", "资本", "买办", "挂路灯", "教员", "公知", "屁股歪了", "夹带私货", "洗地", "回旋镖", "下大棋", "格局", "跪久了", "站起来", "脊梁", "文化入侵", "颜色革命", "殖人", "润人", "神友", "兔友", "纳粹", "恨国党", "拜登", "特朗普", "普京", "泽连斯基", "核污水", "排放", "制裁", "华为", "芯片"],
        bot: ["哈基米", "ChatGPT", "AI生成", "AI绘画", "指令", "语言模型", "人工智能", "典", "孝", "急", "蚌", "绷", "麻", "纯路人", "只有我", "不喜勿喷", "甚至不愿", "前排", "吃瓜", "删前快看", "乐子人", "赢麻了", "急了", "流汗黄豆", "差不多得了"],
        toxic: ["浅草", "馒头币", "航班起飞", "机长", "八方网域", "小白帽", "黑客", "白帽", "大型纪录片", "纪录片", "影像资料", "珍贵影像", "罕见", "狗罕见", "死罕见", "50w", "行走的50w", "耗材", "牧羊犬", "op", "原神怎么你了", "米孝子", "米卫兵", "利刃", "猴", "原来是", "电子宠物", "纯纯的"]
    };

    // Target UID blacklist
    const TARGET_MIDS = [429711841];

    // URLs to block at network level
    const NETWORK_BLOCK_LIST = [
        "cm.bilibili.com",
        "data.bilibili.com",
        "api.bilibili.com/x/ad",
        "live-trace",
        "report",
        "pcn_manage"
    ];

    // Section names to reject in JSON
    const SECTION_BLOCK_LIST = [
        "综艺", "课堂", "推广", "直播", "娱乐", "电影", "电视剧", "纪录片", "番剧", "国创", "游戏"
    ];

    // ========================================================================
    // UI Construction
    // ========================================================================
    function initUI() {
        GM_addStyle(`
            @keyframes shield-roll { 30%, 60%, 90% { transform: scale(1) rotate(0deg); } 10%, 40%, 70% { transform: scale(1.11) rotate(-180deg); } 20%, 50%, 80% { transform: scale(0.9) rotate(-360deg); } }
            #shield-btn { position: fixed; right: 40px; bottom: 120px; height: 20px; width: 20px; border: 1px solid #e9eaec; border-radius: 50%; background-color: #fff; box-shadow: 0 0 12px 4px rgb(106, 115, 133, 22%); padding: 10px; cursor: pointer; animation: shield-roll 1s ease-out; transition: transform 0.2s, box-shadow 0.2s; z-index: 11111; font-size: 18px; display: flex; justify-content: center; align-items: center; color: #fb7299; user-select: none; }
            #shield-btn:hover { box-shadow: 0 0 15px 4px rgba(251, 114, 153, 0.4); transform: rotate(360deg); }
            #shield-panel { position: fixed; bottom: 120px; right: 90px; width: 230px; background: rgba(255, 255, 255, 0.98); color: #333; border-radius: 8px; padding: 15px; z-index: 11112; box-shadow: 0 4px 20px rgba(0,0,0,0.15); border: 1px solid #e7e7e7; font-family: sans-serif; display: none; backdrop-filter: blur(10px); }
            .shield-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 13px; font-weight: 500; }
            .shield-toggle { cursor: pointer; width: 36px; height: 20px; background: #ccc; border-radius: 10px; position: relative; transition: 0.3s; }
            .shield-toggle.on { background: #fb7299; }
            .shield-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: 0.3s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
            .shield-toggle.on::after { left: 18px; }
            #shield-stats { font-size: 11px; color: #999; margin-top: 10px; text-align: center; border-top: 1px solid #eee; padding-top: 5px; }
            #shield-status-text { font-size: 10px; color: #fb7299; text-align: center; height: 14px; margin-bottom: 5px; }
            .shield-sep { border-bottom: 1px dashed #eee; margin: 8px 0; }
        `);

        const btn = document.createElement('div');
        btn.id = 'shield-btn';
        btn.innerText = '🛡️';
        btn.title = 'Open Shield Settings';
        document.body.appendChild(btn);

        const panel = document.createElement('div');
        panel.id = 'shield-panel';
        panel.innerHTML = `
            <div style="font-weight:bold; margin-bottom:10px; text-align:center; color:#fb7299;">全能护盾控制台</div>
            <div id="shield-status-text">系统就绪</div>
            ${createToggleHTML('📺 强制旧版样式 (Pink)', 'enableOldStyle')}
            ${createToggleHTML('💉 Bilibili-Old 兼容模式', 'enableOldCompat')}
            <div class="shield-sep"></div>
            ${createToggleHTML('网络熔断 (去广告)', 'blockNetwork')}
            ${createToggleHTML('首页楼层净化(SSR)', 'cleanHomepageDOM')}
            ${createToggleHTML('过滤纯@评论', 'blockAtOnly')}
            ${createToggleHTML('拦截综艺/娱乐区', 'blockZone')}
            ${createToggleHTML('拦截营销号 (MCN)', 'autoBlockMCN')}
            ${createToggleHTML('拦截初始号 (bili_)', 'blockInitial')}
            ${createToggleHTML('拦截卖课/引流', 'autoBlockMarketing')}
            ${createToggleHTML('拦截剧毒/引战', 'autoBlockToxic')}
            <div id="shield-stats">拦截: 0 | 拉黑: 0</div>
        `;
        document.body.appendChild(panel);

        btn.onclick = (e) => { e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };
        panel.onclick = (e) => { e.stopPropagation(); };
        document.addEventListener('click', () => { panel.style.display = 'none'; });

        const keys = Object.keys(DEFAULT_CONFIG).filter(k => k !== 'minLevel' && k !== 'debug');
        keys.forEach(key => {
            const toggle = document.getElementById(`toggle-${key}`);
            if (toggle) {
                toggle.onclick = () => {
                    const newState = !CONFIG[key];
                    saveSetting(key, newState);
                    toggle.className = `shield-toggle ${newState ? 'on' : ''}`;
                };
            }
        });
    }

    function createToggleHTML(label, key) {
        return `<div class="shield-row"><span>${label}</span><div id="toggle-${key}" class="shield-toggle ${CONFIG[key] ? 'on' : ''}"></div></div>`;
    }

    function updateStatusText(text, color) {
        const el = document.getElementById('shield-status-text');
        if (el) {
            el.innerText = text;
            el.style.color = color;
            setTimeout(() => { el.innerText = "System Ready"; el.style.color = "#fb7299"; }, 3000);
        }
    }

    if (CONFIG.enableOldStyle) applyOldStyle(true);

    function applyOldStyle(enable) {
        let styleTag = document.getElementById('bili-shield-old-style');
        if (enable) {
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'bili-shield-old-style';
                styleTag.innerHTML = `
                    .bili-header__bar { background-color: #fb7299 !important; color: #fff !important; height: 56px !important; box-shadow: 0 2px 4px rgba(0,0,0,.1); }
                    .bili-header .left-entry .v-popover-wrap span, .bili-header .right-entry .v-popover-wrap span, .bili-header .right-entry .right-entry-item { color: #fff !important; text-shadow: 0 1px 1px rgba(0,0,0,0.1); }
                    .bili-header .left-entry .v-popover-wrap svg, .bili-header .right-entry .v-popover-wrap svg, .bili-header .right-entry .right-entry-item svg { fill: #fff !important; color: #fff !important; }
                    .center-search-container .center-search__bar { background-color: rgba(255,255,255,0.9) !important; border: none !important; border-radius: 4px !important; }
                    .center-search__bar #nav-searchform { background: transparent !important; }
                    .center-search__bar .nav-search-btn { background-color: #eee !important; }
                    .bili-header .header-upload-entry { background-color: #fff !important; color: #fb7299 !important; border-radius: 4px !important; }
                    body { font-family: sans-serif !important; }
                    .bili-video-card { border-radius: 4px !important; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
                    .bili-video-card__info--tit { font-size: 14px !important; line-height: 20px !important; padding-top: 8px !important; }
                    #i_cecream { background-color: #f4f5f7 !important; }
                `;
                document.head.appendChild(styleTag);
            }
        } else {
            if (styleTag) styleTag.remove();
        }
    }

    // Default cleanup styles
    GM_addStyle(`
        .ad-report, .bili-video-card__info--ad, #bannerAd, a[href*="cm.bilibili.com"] { display: none !important; }
        a[href*="bilibili.com/bangumi"], a[href*="bilibili.com/cheese"] { display: none !important; }
        .bili-palette-area, .storage-box, .contact-help { display: none !important; }
        .floor-title:contains("综艺"), .bili-grid__title:contains("综艺"), .floor-title:contains("课堂"), .bili-grid__title:contains("课堂") { display: none !important; }
    `);

    let stats = { hidden: 0, blocked: 0 };
    function updateStatsUI() {
        const el = document.getElementById('shield-stats');
        if (el) el.innerHTML = `拦截: <b style='color:#fb7299'>${stats.hidden}</b> | 拉黑: <b style='color:red'>${stats.blocked}</b>`;
    }

    function log(msg, color="#fff", bg="#000") {
        if (CONFIG.debug) console.log(`%c ${msg} `, `color:${color}; background:${bg}; padding:2px; border-radius:2px;`);
    }

    // ========================================================================
    // Logic: Item Filtering
    // ========================================================================
    function shouldRemoveItem(item) {
        if (!item || typeof item !== 'object') return false;

        const title = item.title || item.name || item.desc || "";
        const content = (item.content && item.content.message) ? item.content.message : "";
        const tname = item.tname || item.typename || item.zone || "";
        const gotoType = item.goto || "";
        const uri = item.uri || item.url || item.link || "";
        const ownerName = (item.owner && item.owner.name) ? item.owner.name : (item.member && item.member.uname ? item.member.uname : (item.author || ""));
        const mid = (item.owner && item.owner.mid) ? item.owner.mid : (item.member && item.member.mid ? item.member.mid : (item.mid || 0));
        const isAd = item.is_ad || item.cm_mark || item.ad_info;

        // Filter out comments with only @mentions
        if (CONFIG.blockAtOnly && content) {
            if (/^(\s*@\S+\s*)+$/.test(content)) return { remove: true, block: false };
        }

        // Filter sections/zones
        if (CONFIG.blockZone) {
            if (SECTION_BLOCK_LIST.some(block => title.includes(block) || tname.includes(block))) {
                if (item.items || item.item || tname === item.title) {
                    log(`[Zone] Ignored section: ${title||tname}`, "#ff00ff");
                    return { remove: true, block: false };
                }
            }
        }

        // Filter MCN
        if (CONFIG.autoBlockMCN) {
            for (let pattern of MCN_PATTERNS) {
                if (pattern.test(ownerName)) {
                    return { remove: true, block: true, reason: `MCN:${ownerName}`, mid, uname: ownerName };
                }
            }
        }

        // Filter Initial Accounts
        if (CONFIG.blockInitial && /^bili_\d+$/.test(ownerName)) {
            return { remove: true, block: false };
        }

        // Filter API Identity
        if (CONFIG.blockZone) {
            if (BLOCK_IDENTITY.some(id => tname.includes(id) || gotoType.includes(id) || uri.includes(id))) {
                log(`[API] Blocked identity: ${title}`, "#ff00ff");
                return { remove: true, block: false };
            }
        }

        if (TARGET_MIDS.includes(mid)) return { remove: true, block: false };
        if (CONFIG.autoBlockAds && isAd) return { remove: true, block: false };

        const fullText = title + " " + ownerName + " " + content;
        if (!fullText.trim()) return false;

        // Toxic keywords
        if (CONFIG.autoBlockToxic) {
            const forceKillHit = KEYWORDS.toxic.find(k => fullText.includes(k));
            if (forceKillHit) {
                return { remove: true, block: true, reason: `Toxic:${forceKillHit}`, mid, uname: ownerName };
            }
        }

        // Whitelist Check
        if (WHITE_LIST.some(w => fullText.includes(w))) return false;

        // Marketing Patterns
        if (CONFIG.autoBlockMarketing) {
            for (let pattern of MARKETING_PATTERNS) {
                if (pattern.test(fullText)) {
                    return { remove: true, block: true, reason: "Pattern", mid, uname: ownerName };
                }
            }
        }

        // Title Exemptions
        if (TITLE_EXEMPTIONS.some(ex => fullText.includes(ex))) return false;

        const safeAd = KEYWORDS.ad;
        const safeBot = KEYWORDS.bot;
        const safePol = KEYWORDS.politics;
        let blackList = [];
        if(CONFIG.autoBlockAds) blackList.push(...safeAd);
        if(CONFIG.autoBlockMarketing) blackList.push(...safeBot);
        blackList.push(...safePol);

        const hit = blackList.find(k => fullText.includes(k));
        if (hit) return { remove: true, block: false, reason: `Keyword:${hit}` };

        return false;
    }

    // ========================================================================
    // Data Cleaning (Recursive)
    // ========================================================================
    let blockQueue = [];
    function recursiveClean(obj) {
        if (!obj || typeof obj !== 'object') return obj;

        if (Array.isArray(obj)) {
            const newArr = [];
            for (let item of obj) {
                const check = shouldRemoveItem(item);
                if (check && check.remove) {
                    stats.hidden++;
                    updateStatsUI();
                    if (check.block && check.mid) {
                        stats.blocked++;
                        blockQueue.push({ mid: check.mid, uname: check.uname, reason: check.reason });
                    }
                } else {
                    newArr.push(recursiveClean(item));
                }
            }
            return newArr;
        } else {
            for (let key in obj) {
                if (obj.hasOwnProperty(key)) obj[key] = recursiveClean(obj[key]);
            }
            return obj;
        }
    }

    // ========================================================================
    // Network Interception (XHR) - Old Version Compatibility
    // ========================================================================
    if (CONFIG.enableOldCompat) {
        const originalXhrOpen = XMLHttpRequest.prototype.open;
        const originalXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            return originalXhrOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function(data) {
            if (this._url && (this._url.includes('/x/v2/reply') || this._url.includes('reply'))) {
                const originalOnReadyStateChange = this.onreadystatechange;
                this.onreadystatechange = function() {
                    if (this.readyState === 4 && this.status === 200) {
                        try {
                            const responseData = JSON.parse(this.responseText);
                            const cleanedData = recursiveClean(responseData);
                            Object.defineProperty(this, 'responseText', { value: JSON.stringify(cleanedData), writable: true });
                            Object.defineProperty(this, 'response', { value: JSON.stringify(cleanedData), writable: true });
                        } catch (e) {}
                    }
                    if (originalOnReadyStateChange) originalOnReadyStateChange.apply(this, arguments);
                };
            }
            return originalXhrSend.apply(this, arguments);
        };
    }

    // ========================================================================
    // Network Interception (Fetch) - Modern
    // ========================================================================
    const originalFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async function(...args) {
        const url = args[0] ? args[0].toString() : '';

        // Firewall Mode: Drop connection for ads/trackers
        if (CONFIG.blockNetwork && NETWORK_BLOCK_LIST.some(domain => url.includes(domain))) {
            log(`Blocked Request: ${url}`, "#888");
            const mockBody = JSON.stringify({ code: 0, message: "0", ttl: 1, data: { items: [], item: [], relates: [], replies: [] } });
            return new Response(mockBody, { status: 200, statusText: "OK", headers: new Headers({'Content-Type': 'application/json'}) });
        }

        // Intercept Bilibili API
        if (url.includes('api.bilibili.com') || url.includes('bilibili.com/x/')) {
            const res = await originalFetch(...args);
            const clone = res.clone();
            try {
                let data = await clone.json();
                data = recursiveClean(data);
                const newRes = new Response(JSON.stringify(data), {
                    status: res.status, statusText: res.statusText, headers: res.headers
                });
                Object.defineProperty(newRes, 'url', { value: res.url });
                return newRes;
            } catch (e) { return res; }
        }
        return originalFetch(...args);
    };

    // ========================================================================
    // DOM Cleaning (Visual Hiding)
    // ========================================================================
    function hideFloors() {
        if (!CONFIG.cleanHomepageDOM) return;

        const titles = document.querySelectorAll('.floor-title, .bili-grid__title, .zone-title, .name, .rec-title');
        titles.forEach(el => {
            const text = el.innerText.trim();
            if (TARGET_FLOORS.some(target => text.includes(target))) {
                const container = el.closest('.floor-single-card') || el.closest('.bili-grid') || el.closest('section') || el.closest('.floor-wrap') || el.closest('.video-card-reco') || el.closest('.zone-module') || el.closest('.b-r');
                if (container) {
                    container.style.display = 'none';
                    container.setAttribute('data-shield-hidden', 'true');
                    log(`Hidden Floor: ${text}`, "#ffa500");
                }
            }
        });

        const cards = document.querySelectorAll('.floor-single-card, .bili-video-card, .feed-card, .bili-live-card, .video-card-common');
        cards.forEach(card => {
            if (card.getAttribute('data-shield-hidden')) return;
            const text = card.innerText;
            const link = card.querySelector('a');
            let shouldHide = false;

            if (link && (link.href.includes('/variety/') || link.href.includes('/cheese/') || link.href.includes('/guochuang/'))) shouldHide = true;
            else if (CONFIG.blockZone && (BLOCK_IDENTITY.some(k => text.includes(k)) || MARKETING_PATTERNS.some(p => p.test(text)))) {
                if (!WHITE_LIST.some(w => text.includes(w))) shouldHide = true;
            }

            if (shouldHide) {
                card.style.display = 'none';
                card.setAttribute('data-shield-hidden', 'true');
            }
        });
    }

    if (location.href.includes('bilibili.com')) {
        const observer = new MutationObserver(() => hideFloors());
        setTimeout(() => { hideFloors(); observer.observe(document.body, { childList: true, subtree: true }); }, 1000);
        setTimeout(initUI, 2000);
    }

    // ========================================================================
    // Auto Blocking Service
    // ========================================================================
    let isProcessing = false;
    const getCsrf = () => { const m = document.cookie.match(/bili_jct=([^;]+)/); return m ? m[1] : null; };
    function processBlockQueue() {
        if (isProcessing || blockQueue.length === 0) return;
        const task = blockQueue.shift();
        const csrf = getCsrf();
        if (!csrf) return;
        isProcessing = true;
        GM_xmlhttpRequest({
            method: "POST", url: "https://api.bilibili.com/x/relation/modify",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            data: `fid=${task.mid}&act=5&re_src=11&csrf=${csrf}&jsonp=jsonp`,
            onload: () => { log(`Auto Blocked: ${task.uname}`, "#0f0"); setTimeout(() => { isProcessing = false; processBlockQueue(); }, CONFIG.blockInterval); },
            onerror: () => { isProcessing = false; }
        });
    }
    setInterval(processBlockQueue, 1000);
    console.log("%c Shield V1.1.0 (Final) Active ", "background: #fb7299; color: #fff; padding: 4px;");
})();
