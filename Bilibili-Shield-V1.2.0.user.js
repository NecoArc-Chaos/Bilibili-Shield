// ==UserScript==
// @name         Bilibili 全能护盾
// @namespace    https://github.com/Sakurairinaqwq/Bilibili-Shield
// @version      1.2.0i
// @description  全链路净化：新增 Bilibili-Old 推广模块(#home_popularize)、直播模块(#bili_live)及直播导航项强制移除。
// @author       Sakurairinaqwq
// @match        *://*.bilibili.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. 指纹库与关键词配置 (保持 1.1.0 的核心逻辑) ---
    const CONFIG = {
        home: localStorage.getItem('sw-home') !== 'false',
        mcn: localStorage.getItem('sw-mcn') !== 'false',
        pink: localStorage.getItem('sw-pink') !== 'false',
        danmaku: localStorage.getItem('sw-danmaku') !== 'false',
        audit: localStorage.getItem('sw-audit') !== 'false',
        checkLevel: 3,

        blockedGotos: ['ad', 'banner', 'cm', 'live', 'cheese', 'course', 'bangumi', 'pgc', 'movie', 'tv', 'documentary', 'manga', 'comic', 'special', 'vertical_av'],
        blockedTnames: ['课堂', '综艺', '纪录片', '电视剧', '电影', '直播', '漫画', '国创', '番剧'],

        mcnPatterns: [/.*八方网域.*/, /.*小白帽.*/, /.*黑客.*/, /.*渗透.*/, /.*攻防.*/, /.*脚本.*/, /.*讲故事.*/, /.*文旅.*/, /.*哈基米.*/, /^bili_\d+$/, /.*新闻$/, /.*帮忙$/, /.*视讯$/, /.*要闻$/, /.*都市报$/, /.*日报$/, /.*晚报$/, /.*早报$/, /.*商报$/, /.*快报$/, /^环球.*/, /.*时报$/, /.*财经$/, /.*视频$/, /.*资讯$/, /.*观察$/, /.*在线$/, /.*TV$/, /.*卫视$/, /.*广播.*/, /.*融媒.*/, /.*发布$/, /.*官方$/, /.*网$/, /.*看点$/],

        badWords: ["看我动态", "置顶", "加v", "加V", "加q", "加Q", "薇信", "威信", "企鹅", "加群", "入群", "建群", "Q群", "裙号", "日结", "赚米", "收米", "搞米", "兼职", "拼兮兮", "拼夕夕", "私我", "点击头像", "同城","间谍", "特务", "渗透", "美帝", "老美", "阿美", "昂撒", "北约", "犹太", "以色列", "乌贼", "毛子", "大毛", "二毛", "小日本", "脚盆鸡", "鬼子", "棒子", "偷国", "阿三", "湾湾", "蛙", "呆蛙", "1450", "ww", "资本", "买办", "挂路灯", "教员", "公知", "屁股歪了", "洗地", "回旋镖", "下大棋", "格局", "跪久了", "站起来", "脊梁", "文化入侵", "颜色革命", "殖人", "润人", "神友", "兔友", "纳粹", "恨国党", "拜登", "特朗普", "普京", "泽连斯基", "核污水", "排放", "制裁", "华为", "芯片","哈基米", "ChatGPT", "AI生成", "AI绘画", "指令", "语言模型", "人工智能", "典", "孝", "急", "蚌", "绷", "麻", "纯路人", "只有我", "不喜勿喷", "甚至不愿", "前排", "吃瓜", "删前快看", "乐子人", "赢麻了", "急了", "流汗黄豆", "差不多得了","浅草", "馒头币", "航班起飞", "机长", "八方网域", "小白帽", "黑客", "白帽", "大型纪录片", "纪录片", "影像资料", "珍贵影像", "罕见", "狗罕见", "死罕见", "50w", "行走的50w", "耗材", "牧羊犬", "op", "原神怎么你了", "米孝子", "米卫兵", "利刃", "猴", "原来是", "电子宠物", "纯纯的"]
    };

    const userCache = new Map();

    // --- 2. 净化引擎 ---
    const ShieldEngine = {
        checkMCN(name) { return CONFIG.mcnPatterns.some(reg => reg.test(name)); },
        checkBadContent(text) { return text ? CONFIG.badWords.some(word => text.includes(word)) : false; },

        async isSuspect(mid) {
            if (!CONFIG.audit || userCache.has(mid)) return userCache.get(mid) || false;
            try {
                const resp = await fetch(`https://api.bilibili.com/x/space/wbi/acc/info?mid=${mid}`);
                const res = await resp.json();
                if (res.code === 0) {
                    const suspect = res.data.level < CONFIG.checkLevel || (!res.data.top_photo && res.data.birthday === 0);
                    userCache.set(mid, suspect);
                    return suspect;
                }
            } catch (e) { return false; }
            return false;
        },

        async filter(data, url) {
            try {
                const items = data.data?.item || data.data?.result || (Array.isArray(data.data) ? data.data : null);
                if (items && Array.isArray(items)) {
                    const clean = items.filter(item => {
                        const hitTitle = this.checkBadContent(item.title);
                        const hitMcn = CONFIG.mcn && this.checkMCN(item.owner?.name || item.author);
                        const isBadType = CONFIG.blockedGotos.includes(item.goto) || CONFIG.blockedTnames.includes(item.tname);
                        return !(hitTitle || hitMcn || isBadType || item.is_ad);
                    });
                    if (data.data?.item) data.data.item = clean;
                    else if (data.data?.result) data.data.result = clean;
                    else if (Array.isArray(data.data)) data.data = clean;
                }
                if (url.includes('v2/reply') && data.data?.replies) {
                    const auditResults = await Promise.all(data.data.replies.map(async (r) => {
                        if (this.checkBadContent(r.content.message)) {
                            return (await this.isSuspect(r.mid)) ? null : r;
                        }
                        return r;
                    }));
                    data.data.replies = auditResults.filter(r => r !== null);
                }
            } catch (e) {}
            return data;
        }
    };

    // --- 3. 网络劫持与样式补丁 (新增 B-Old 封杀 CSS) ---
    const hookNetwork = () => {
        const originFetch = window.fetch;
        window.fetch = async (...args) => {
            const res = await originFetch(...args);
            const url = args[0].toString();
            if (url.includes('bilibili.com') && res.headers.get('content-type')?.includes('json')) {
                const clone = res.clone();
                try {
                    let json = await clone.json();
                    json = await ShieldEngine.filter(json, url);
                    return new Response(JSON.stringify(json), res);
                } catch (e) { return res; }
            }
            return res;
        };

        const originOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function() {
            this.addEventListener('readystatechange', async function() {
                if (this.readyState === 4 && this.status === 200) {
                    try {
                        let json = JSON.parse(this.responseText);
                        json = await ShieldEngine.filter(json, this.responseURL);
                        Object.defineProperty(this, 'responseText', { writable: true, value: JSON.stringify(json) });
                    } catch (e) {}
                }
            });
            originOpen.apply(this, arguments);
        };
    };

    const injectStyles = () => {
        const style = document.createElement('style');
        let css = `
            /* 新版/通用推广剔除 */
            .feed-card:has(.floor-single-card), .floor-single-card, .ad-report, .bili-video-card__info--ad, .recommended-swipe, .trending, .nav-gift { display: none !important; }

            /* Bilibili-Old 专属封杀名单 */
            #home_popularize,                       /* 旧版推广模块 */
            #bili_live,                             /* 旧版直播区域 */
            .popularize-module,                     /* 旧版推广类名备份 */
            .item.sortable[sortindex="0"],           /* 导航栏直播项（通常 index 为 0） */
            .item.sortable:has(a[href*="live.bilibili.com"]) {
                display: none !important;
                visibility: hidden !important;
                height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
            }
        `;
        if (CONFIG.pink) {
            css += `#biliMainHeader, .bili-header__bar { background-color: #fb7299 !important; } .nav-link, .entry-title { color: #fff !important; } .bili-header__logo { filter: hue-rotate(320deg) brightness(1.1) !important; }`;
        }
        if (CONFIG.danmaku) {
            CONFIG.badWords.forEach(word => {
                css += `.bili-dm-item[data-text*="${word}"] { display: none !important; }`;
            });
        }
        style.textContent = css;
        document.documentElement.appendChild(style);
    };

    // --- 4. 实时清道夫 (新增 B-Old DOM 强删) ---
    const domSweeper = () => {
        const obs = new MutationObserver(() => {
            // A. 移除新版横向卡片
            document.querySelectorAll('.floor-single-card').forEach(el => {
                const card = el.closest('.feed-card') || el;
                if (card.parentNode) card.remove();
            });

            // B. 移除 Bilibili-Old 指定 ID 模块
            ['home_popularize', 'bili_live'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.parentNode) el.remove();
            });

            // C. 移除 Bilibili-Old 直播导航项
            document.querySelectorAll('.item.sortable').forEach(el => {
                if (el.innerText.includes('直播') || el.innerHTML.includes('live.bilibili.com')) {
                    el.remove();
                }
            });
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
    };

    // --- 5. UI 面板 ---
    const createUI = () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `
            <style>
                #launcher { position: fixed; bottom: 30px; right: 30px; width: 48px; height: 48px; background: #fb7299; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483647; box-shadow: 0 4px 15px rgba(251,114,153,0.4); font-size: 24px; transition: 0.3s; }
                #panel { position: fixed; bottom: 90px; right: 30px; width: 240px; background: #fff; border: 2px solid #fb7299; border-radius: 16px; padding: 18px; display: none; flex-direction: column; gap: 12px; z-index: 2147483647; box-shadow: 0 10px 30px rgba(0,0,0,0.15); font-family: sans-serif; }
                .row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
            </style>
            <div id="launcher">🛡️</div>
            <div id="panel">
                <div style="font-weight:bold;color:#fb7299;text-align:center;border-bottom:1px solid #eee;padding-bottom:8px">全能护盾 v3.1 (Old Fix)</div>
                <div class="row"><span>旧版推广/直播剔除</span><input type="checkbox" id="sw-home" ${CONFIG.home?'checked':''}></div>
                <div class="row"><span>硬核词库过滤</span><input type="checkbox" id="sw-mcn" ${CONFIG.mcn?'checked':''}></div>
                <div class="row"><span>主动画像巡检</span><input type="checkbox" id="sw-audit" ${CONFIG.audit?'checked':''}></div>
                <div class="row"><span>粉色复刻模式</span><input type="checkbox" id="sw-pink" ${CONFIG.pink?'checked':''}></div>
                <div class="row"><span>弹幕实时降噪</span><input type="checkbox" id="sw-danmaku" ${CONFIG.danmaku?'checked':''}></div>
                <div style="font-size: 10px; color: #999; text-align: center;">变更刷新后生效</div>
            </div>`;
        const panel = shadow.getElementById('panel');
        shadow.getElementById('launcher').onclick = () => panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
        shadow.querySelectorAll('input').forEach(ipt => ipt.onchange = () => localStorage.setItem(ipt.id.replace('sw-', 'sw-'), ipt.checked));
    };

    // --- 6. 启动 ---
    hookNetwork();
    const start = () => { injectStyles(); createUI(); domSweeper(); };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start); else start();
    console.log("%c [Shield 3.1] 针对 Bilibili-Old 的推广及直播模块已全面封杀 ", "background: #fb7299; color: #fff; padding: 5px;");
})();
