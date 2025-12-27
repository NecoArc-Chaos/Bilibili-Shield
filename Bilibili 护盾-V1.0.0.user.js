// ==UserScript==
// @name         Bilibili 护盾
// @namespace    https://github.com/Sakurairinaqwq/Bilibili-Shield
// @author       Sakurairinaqwq
// @version      V1.0.0
// @description  全能净化终极形态。新增【图形化控制面板】：点击右下角盾牌即可开关各项功能（综艺/营销号/卖课/广告等）。支持配置自动保存。
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

    // ===========================
    // ⚙️ 默认配置与存储管理
    // ===========================
    const DEFAULT_CONFIG = {
        minLevel: 2,
        debug: true,
        // 开关状态 (默认为 true: 开启拦截)
        cleanHomepageDOM: true,   // 首页楼层净化 (综艺/课堂等DOM)
        autoBlockMCN: true,       // 拦截营销号/机构号
        autoBlockMarketing: true, // 拦截卖课/引流
        autoBlockAds: true,       // 拦截广告
        autoBlockToxic: true,     // 拦截剧毒/引战
        blockZone: true,          // 拦截特定分区(综艺/娱乐)
        blockInitial: true        // 拦截初始号(bili_xxx)
    };

    // 从存储读取配置，如果没有则使用默认
    const CONFIG = {
        ...DEFAULT_CONFIG,
        ...{
            cleanHomepageDOM: GM_getValue('cleanHomepageDOM', DEFAULT_CONFIG.cleanHomepageDOM),
            autoBlockMCN: GM_getValue('autoBlockMCN', DEFAULT_CONFIG.autoBlockMCN),
            autoBlockMarketing: GM_getValue('autoBlockMarketing', DEFAULT_CONFIG.autoBlockMarketing),
            autoBlockAds: GM_getValue('autoBlockAds', DEFAULT_CONFIG.autoBlockAds),
            autoBlockToxic: GM_getValue('autoBlockToxic', DEFAULT_CONFIG.autoBlockToxic),
            blockZone: GM_getValue('blockZone', DEFAULT_CONFIG.blockZone),
            blockInitial: GM_getValue('blockInitial', DEFAULT_CONFIG.blockInitial),
        }
    };

    // 保存配置函数
    function saveSetting(key, value) {
        CONFIG[key] = value;
        GM_setValue(key, value);
        log(`[设置] ${key} -> ${value}`, "#00a1d6");
        // 如果关闭了某些功能，提示刷新
        if (!value) {
            updateStatusText("已关闭部分功能，刷新页面生效", "yellow");
        } else {
            updateStatusText("设置已更新", "lime");
        }
    }

    // ===========================
    // 📝 词库定义 (保持之前的强力词库)
    // ===========================

    // 🟢【白名单】
    const WHITE_LIST = [
        "谢谢", "加油", "求bgm", "求BGM", "好听", "三连", "下次", "教程", "辛苦", "借吉言",
        "互关", "好人", "大神", "可爱", "指路", "课代表", "快乐",
        "罕见病", "不罕见", "罕见气象", "罕见生物", "罕见奇观", "比较罕见",
        "间谍过家家", "间谍片", "间谍电影", "间谍游戏", "双重间谍",
        "原神攻略", "剧情", "角色", "深渊", "圣遗物", "卡池", "pv", "PV", "联动", "二创",
        "无畏契约", "音乐", "约定", "第一人称", "世界第一", "公开课", "考研", "数学", "笔记",
        "朱迪", "一群", "群众", "群聊", "群主", "人群", "批评", "批准", "批量", "大米", "玉米", "厘米", "纳米", "毫米", "赢家", "双赢", "躺赢",
        "网络安全科普", "反诈", "防骗", "硬核", "极客"
    ];

    // 📰【营销号名字特征】
    const MCN_PATTERNS = [
        /.*八方网域.*/, /.*小白帽.*/, /.*黑客.*/, /.*渗透.*/, /.*攻防.*/, /.*脚本.*/,
        /.*讲故事.*/, /.*文旅.*/, /.*哈基米.*/,
        /.*新闻$/, /.*帮忙$/, /.*视讯$/, /.*要闻$/, /.*都市报$/, /.*日报$/, /.*晚报$/, /.*早报$/, /.*商报$/, /.*快报$/,
        /^环球.*/, /.*时报$/, /.*财经$/, /.*视频$/, /.*资讯$/, /.*观察$/, /.*在线$/, /.*TV$/, /.*卫视$/, /.*广播.*/,
        /.*融媒.*/, /.*发布$/, /.*官方$/, /.*网$/, /.*看点$/
    ];

    // ⚡【API身份/分区 黑名单】
    const BLOCK_IDENTITY = [
        "综艺", "课堂", "推广", "cheese", "cm_ad", "ad", "live", "game", "娱乐",
        "纪录片", "电影", "电视剧", "番剧", "国创", "pgc", "ogv", "bangumi", "cinema"
    ];

    // 🏗️【楼层拆除名单】
    const TARGET_FLOORS = [
        "综艺", "课堂", "推广", "直播", "娱乐", "纪录片", "电影", "电视剧", "番剧", "国创"
    ];

    // 🛡️【视频标题豁免词】
    const TITLE_EXEMPTIONS = [
        "第一", "前排", "吃瓜", "纯路人", "只有我", "不喜勿喷", "甚至不愿", "震惊", "曝光"
    ];

    // 📦 【特征指纹】
    const MARKETING_PATTERNS = [
        /^【.*(?:送|领|免费|加V|加v|变现|搞钱|副业|日入|月入).*】/,
        /^【.*(?:资料|课程|训练营|实操|速成).*】/,
        /PS异闻录/, /萌新系统入门/, /入门到入狱/, /接单/, /渗透测试/, /Kali/
    ];

    // 📦 【关键词库】
    const KEYWORDS = {
        ad: ["看我动态", "置顶", "加v", "加V", "加q", "加Q", "薇信", "威信", "企鹅", "加群", "入群", "建群", "Q群", "裙号", "日结", "赚米", "收米", "搞米", "兼职", "拼兮兮", "拼夕夕", "私我", "点击头像", "同城"],
        politics: ["间谍", "特务", "渗透", "美帝", "老美", "阿美", "昂撒", "北约", "犹太", "以色列", "乌贼", "毛子", "大毛", "二毛", "小日本", "脚盆鸡", "鬼子", "棒子", "偷国", "阿三", "湾湾", "蛙", "呆蛙", "1450", "ww", "资本", "买办", "挂路灯", "教员", "公知", "屁股歪了", "夹带私货", "洗地", "回旋镖", "下大棋", "格局", "跪久了", "站起来", "脊梁", "文化入侵", "颜色革命", "殖人", "润人", "神友", "兔友", "纳粹", "恨国党", "拜登", "特朗普", "普京", "泽连斯基", "核污水", "排放", "制裁", "华为", "芯片"],
        bot: ["哈基米", "ChatGPT", "AI生成", "AI绘画", "指令", "语言模型", "人工智能", "典", "孝", "急", "蚌", "绷", "麻", "纯路人", "只有我", "不喜勿喷", "甚至不愿", "前排", "吃瓜", "删前快看", "乐子人", "赢麻了", "急了", "流汗黄豆", "差不多得了"],
        toxic: ["八方网域", "小白帽", "黑客", "白帽", "大型纪录片", "纪录片", "影像资料", "珍贵影像", "罕见", "狗罕见", "死罕见", "50w", "行走的50w", "耗材", "牧羊犬", "op", "原神怎么你了", "米孝子", "米卫兵", "利刃", "猴", "原来是", "电子宠物", "纯纯的"]
    };

    const TARGET_MIDS = [429711841];

    // ===========================
    // 🎨 UI 界面构建
    // ===========================
    function initUI() {
        // 1. 注入 CSS
        GM_addStyle(`
            #shield-btn {
                position: fixed; bottom: 50px; right: 20px; width: 40px; height: 40px;
                background: #fb7299; border-radius: 50%; box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                z-index: 999999; cursor: pointer; display: flex; justify-content: center; align-items: center;
                font-size: 24px; transition: transform 0.2s; user-select: none;
            }
            #shield-btn:hover { transform: scale(1.1); }
            #shield-panel {
                position: fixed; bottom: 100px; right: 20px; width: 220px;
                background: rgba(30, 30, 30, 0.95); color: #fff;
                border-radius: 8px; padding: 15px; z-index: 999999;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 1px solid #444;
                font-family: sans-serif; display: none; backdrop-filter: blur(5px);
            }
            .shield-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 13px; }
            .shield-toggle { cursor: pointer; width: 36px; height: 20px; background: #555; border-radius: 10px; position: relative; transition: 0.3s; }
            .shield-toggle.on { background: #fb7299; }
            .shield-toggle::after {
                content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
                background: #fff; border-radius: 50%; transition: 0.3s;
            }
            .shield-toggle.on::after { left: 18px; }
            #shield-stats { font-size: 11px; color: #aaa; margin-top: 10px; text-align: center; border-top: 1px solid #444; padding-top: 5px; }
            #shield-status-text { font-size: 10px; color: lime; text-align: center; height: 14px; margin-bottom: 5px;}
        `);

        // 2. 创建悬浮球
        const btn = document.createElement('div');
        btn.id = 'shield-btn';
        btn.innerText = '🛡️';
        btn.title = 'B站护盾设置';
        document.body.appendChild(btn);

        // 3. 创建面板
        const panel = document.createElement('div');
        panel.id = 'shield-panel';
        panel.innerHTML = `
            <div style="font-weight:bold; margin-bottom:10px; text-align:center; color:#fb7299;">🛡️ Bilibili护盾控制台</div>
            <div id="shield-status-text">运行中...</div>
            ${createToggleHTML('首页楼层净化', 'cleanHomepageDOM')}
            ${createToggleHTML('拦截综艺/娱乐分区', 'blockZone')}
            ${createToggleHTML('拦截营销号 (MCN)', 'autoBlockMCN')}
            ${createToggleHTML('拦截卖课/引流', 'autoBlockMarketing')}
            ${createToggleHTML('拦截初始号 (bili_)', 'blockInitial')}
            ${createToggleHTML('拦截剧毒/引战', 'autoBlockToxic')}
            ${createToggleHTML('拦截通用广告', 'autoBlockAds')}
            <div id="shield-stats">拦截: 0 | 拉黑: 0</div>
        `;
        document.body.appendChild(panel);

        // 4. 绑定事件
        btn.onclick = () => {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        };

        // 绑定开关点击
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
        return `
            <div class="shield-row">
                <span>${label}</span>
                <div id="toggle-${key}" class="shield-toggle ${CONFIG[key] ? 'on' : ''}"></div>
            </div>
        `;
    }

    function updateStatusText(text, color) {
        const el = document.getElementById('shield-status-text');
        if (el) {
            el.innerText = text;
            el.style.color = color;
            setTimeout(() => { el.innerText = "运行中..."; el.style.color = "lime"; }, 3000);
        }
    }

    // ===========================
    // 🎨 全局 CSS 注入 (受控)
    // ===========================
    // 始终开启的基础广告拦截
    GM_addStyle(`.ad-report, .bili-video-card__info--ad, #bannerAd, a[href*="cm.bilibili.com"] { display: none !important; } .bili-palette-area, .storage-box, .contact-help { display: none !important; }`);

    // 动态控制的 CSS (综艺/楼层) - 如果开启了 cleanHomepageDOM
    if (CONFIG.cleanHomepageDOM) {
        GM_addStyle(`
            .floor-title:contains("综艺"), .bili-grid__title:contains("综艺"),
            .floor-title:contains("电影"), .bili-grid__title:contains("电影"),
            .floor-title:contains("电视剧"), .bili-grid__title:contains("电视剧"),
            .floor-title:contains("纪录片"), .bili-grid__title:contains("纪录片"),
            .floor-title:contains("课堂"), .bili-grid__title:contains("课堂"),
            .floor-title:contains("推广"), .bili-grid__title:contains("推广")
            { display: none !important; }
            a[href*="bilibili.com/bangumi"], a[href*="bilibili.com/cheese"] { display: none !important; }
        `);
    }

    // ===========================
    // 📊 状态更新
    // ===========================
    let stats = { hidden: 0, blocked: 0 };
    function updateStatsUI() {
        const el = document.getElementById('shield-stats');
        if (el) {
            el.innerHTML = `拦截: <b style='color:yellow'>${stats.hidden}</b> | 拉黑: <b style='color:red'>${stats.blocked}</b>`;
        }
    }

    // ===========================
    // 🧠 日志系统
    // ===========================
    function log(msg, color="#fff", bg="#000") {
        if (CONFIG.debug) {
            console.log(`%c ${msg} `, `color:${color}; background:${bg}; padding:2px; border-radius:2px;`);
        }
    }

    // ===========================
    // 🧠 核心匹配逻辑
    // ===========================
    function hitBlacklistForComment(text) {
        if (!text) return false;
        if (WHITE_LIST.some(w => text.includes(w))) return false;
        const allBlack = [...KEYWORDS.toxic, ...KEYWORDS.politics, ...KEYWORDS.ad, ...KEYWORDS.bot];
        return allBlack.find(k => text.includes(k));
    }

    function shouldRemoveItem(item) {
        if (!item || typeof item !== 'object') return false;

        const title = item.title || item.name || item.desc || "";
        const tname = item.tname || item.typename || item.zone || "";
        const gotoType = item.goto || "";
        const uri = item.uri || item.url || item.link || "";
        const ownerName = (item.owner && item.owner.name) ? item.owner.name : (item.author || "");
        const mid = (item.owner && item.owner.mid) ? item.owner.mid : (item.mid || 0);
        const isAd = item.is_ad || item.cm_mark || item.ad_info;

        // 1. 检查 MCN/营销号特征
        if (CONFIG.autoBlockMCN) {
            for (let pattern of MCN_PATTERNS) {
                if (pattern.test(ownerName)) {
                    log(`[MCN] ${ownerName} - ${title}`, "#ffa500");
                    return { remove: true, block: true, reason: `MCN:${ownerName}`, mid, uname: ownerName };
                }
            }
        }

        // 2. 检查初始号
        if (CONFIG.blockInitial && /^bili_\d+$/.test(ownerName)) {
             log(`[初始号] ${ownerName}`, "#ffa500");
             return { remove: true, block: false }; // 初始号太多，建议只删不拉黑，防止黑名单爆满
        }

        // 3. 检查 API 身份/分区 (综艺/娱乐)
        if (CONFIG.blockZone) {
            if (BLOCK_IDENTITY.some(id => tname.includes(id) || gotoType.includes(id) || uri.includes(id))) {
                log(`[API分区] ${title} [${tname}/${gotoType}]`, "#ff00ff");
                return { remove: true, block: false };
            }
        }

        // 4. 检查 UID
        if (TARGET_MIDS.includes(mid)) {
             log(`[UID] ${title} [${mid}]`, "#ff0000");
             return { remove: true, block: false };
        }

        // 5. 检查广告字段
        if (CONFIG.autoBlockAds && isAd) return { remove: true, block: false };

        // 6. 检查关键词 (绝杀)
        const fullText = title + " " + ownerName;
        if (!fullText.trim()) return false;

        if (CONFIG.autoBlockToxic) {
            const forceKillHit = KEYWORDS.toxic.find(k => fullText.includes(k));
            if (forceKillHit) {
                log(`[毒] ${title} [${forceKillHit}]`, "#ff00ff");
                return { remove: true, block: true, reason: `Kill:${forceKillHit}`, mid, uname: ownerName };
            }
        }

        // --- 白名单检查 ---
        if (WHITE_LIST.some(w => fullText.includes(w))) return false;

        // 7. 卖课指纹
        if (CONFIG.autoBlockMarketing) {
            for (let pattern of MARKETING_PATTERNS) {
                if (pattern.test(fullText)) return { remove: true, block: true, reason: "Pattern", mid, uname: ownerName };
            }
        }

        // 8. 标题豁免
        if (TITLE_EXEMPTIONS.some(ex => fullText.includes(ex))) return false;

        // 9. 普通关键词
        const safeAd = KEYWORDS.ad;
        const safeBot = KEYWORDS.bot;
        const safePol = KEYWORDS.politics;
        let blackList = [];
        if(CONFIG.autoBlockAds) blackList.push(...safeAd);
        if(CONFIG.autoBlockMarketing) blackList.push(...safeBot); // 烂梗归为营销一类处理
        blackList.push(...safePol);

        const hit = blackList.find(k => fullText.includes(k));
        if (hit) return { remove: true, block: false, reason: `Key:${hit}` };

        return false;
    }

    // ==========================================
    // API 数据清洗
    // ==========================================
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
                if (obj.hasOwnProperty(key)) {
                    obj[key] = recursiveClean(obj[key]);
                }
            }
            return obj;
        }
    }

    const originalFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async function(...args) {
        const url = args[0] ? args[0].toString() : '';
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

    // ==========================================
    // DOM 移除 (辅助 API)
    // ==========================================
    function blastFloors() {
        if (!CONFIG.cleanHomepageDOM) return;

        const titles = document.querySelectorAll('.floor-title, .bili-grid__title, .zone-title, .name');
        titles.forEach(el => {
            const text = el.innerText.trim();
            if (TARGET_FLOORS.some(target => text.includes(target))) {
                const container = el.closest('.bili-grid') || el.closest('section') || el.closest('.floor-wrap') || el.closest('.video-card-reco');
                if (container) container.style.display = 'none';
            }
        });

        // 移除单卡
        const cards = document.querySelectorAll('.floor-single-card, .bili-video-card, .feed-card, .bili-live-card');
        cards.forEach(card => {
            const text = card.innerText;
            const isTarget = BLOCK_IDENTITY.some(k => text.includes(k)) || MARKETING_PATTERNS.some(p => p.test(text));
            if (isTarget && !WHITE_LIST.some(w => text.includes(w))) {
                card.style.display = 'none';
            }
        });
    }

    if (location.href.includes('bilibili.com')) {
        const observer = new MutationObserver(() => blastFloors());
        setTimeout(() => { blastFloors(); observer.observe(document.body, { childList: true, subtree: true }); }, 1000);

        // 延迟初始化UI，防止遮挡
        setTimeout(initUI, 2000);
    }

    // ==========================================
    // 后台拉黑任务
    // ==========================================
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
            onload: () => {
                log(`[AutoBlock] ${task.uname}`, "#0f0");
                setTimeout(() => { isProcessing = false; processBlockQueue(); }, CONFIG.blockInterval);
            },
            onerror: () => { isProcessing = false; }
        });
    }
    setInterval(processBlockQueue, 1000);

    console.log("%c 🛡️ Bilibili Shield V38 (UI Mode) ", "background: #fb7299; color: #fff; padding: 4px; border-radius: 4px;");
})();