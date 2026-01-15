/* ========================================
   哔哩哔哩全能护盾 - JavaScript
   ======================================== */

// --- Live2D 台词库 ---
const WORDS = [
    "戳我干嘛呀？快去安装脚本！(≧∇≦)ﾉ",
    "这是全能护盾的官网哦！",
    "御坂网络连接正常...",
    "不要乱动人家啦！",
    "广告什么的，最讨厌了！",
    "今天也要元气满满哦！"
];

// --- 1. Live2D 初始化 ---
window.onload = async function() {
    const loader = document.getElementById('loader');
    const bubble = document.getElementById('speech-bubble');
    const statusDiv = document.getElementById('status');
    const container = document.getElementById('live2d-container');
    const canvas = document.getElementById('live2d-canvas');

    // 检查环境
    if (window.location.protocol === 'file:') {
        statusDiv.innerText = "请使用 VSCode Live Server 运行！";
        statusDiv.style.color = "#ff5d5d";
        return;
    }

    const modelPath = 'Live2d/33/33.default.model.json';
    
    // 获取容器的实际尺寸
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // 设置 canvas 的实际像素尺寸（关键！）
    canvas.width = containerWidth;
    canvas.height = containerHeight;

    // 正确初始化 PIXI Application
    const app = new PIXI.Application({
        view: canvas,
        autoStart: true,
        backgroundAlpha: 0,
        width: containerWidth,
        height: containerHeight,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
    });

    try {
        const model = await PIXI.live2d.Live2DModel.from(modelPath);
        app.stage.addChild(model);

        // --- 修复后的定位算法 ---
        
        // 获取模型原始尺寸
        const modelWidth = model.internalModel.width;
        const modelHeight = model.internalModel.height;
        
        console.log("容器尺寸:", containerWidth, "x", containerHeight);
        console.log("模型原始尺寸:", modelWidth, "x", modelHeight);

        // 计算缩放比例：让模型完整显示在容器内
        // 取宽度和高度的较小比例，确保模型不会超出
        const scaleX = containerWidth / modelWidth;
        const scaleY = containerHeight / modelHeight;
        const scale = Math.min(scaleX, scaleY) * 0.85; // 留一点边距
        
        model.scale.set(scale);
        
        // 计算缩放后的实际尺寸
        const scaledWidth = modelWidth * scale;
        const scaledHeight = modelHeight * scale;

        // 设置锚点到底部中心（关键修复！）
        model.anchor.set(0.5, 1);
        
        // X: 水平居中
        model.x = containerWidth / 2;
        
        // Y: 底部对齐（因为锚点在底部，所以直接设为容器高度）
        model.y = containerHeight;

        console.log("缩放比例:", scale);
        console.log("缩放后尺寸:", scaledWidth, "x", scaledHeight);
        console.log("模型位置: X=", model.x, "Y=", model.y);

        // --- 交互 ---
        model.interactive = true;
        model.buttonMode = true;

        model.on('pointertap', () => { 
            // 1. 动作
            model.motion('tap_body'); 
            
            // 2. 气泡
            const text = WORDS[Math.floor(Math.random() * WORDS.length)];
            bubble.innerText = text;
            bubble.classList.add('show');

            // 3. 定时隐藏
            clearTimeout(window.bubbleTimer);
            window.bubbleTimer = setTimeout(() => {
                bubble.classList.remove('show');
            }, 3000);
        });

        console.log("✅ Live2D 模型加载成功！");
        setTimeout(() => { loader.classList.add('hide'); }, 800);

    } catch (error) {
        console.error("Live2D 加载失败:", error);
        statusDiv.innerText = "加载失败，请检查文件路径";
        // 失败也要进页面
        setTimeout(() => { loader.classList.add('hide'); }, 2000);
    }
};

// --- 2. 鼠标点击粒子特效 ---
document.addEventListener('click', (e) => {
    // 点击模型时不触发背景粒子
    if(e.target.tagName === 'CANVAS') return;

    const colors = ['#FB7299', '#00A1D6', '#FFD700'];
    for (let i = 0; i < 8; i++) {
        const p = document.createElement('div');
        p.classList.add('particle');
        document.body.appendChild(p);
        const size = Math.random() * 8 + 4;
        p.style.width = `${size}px`; 
        p.style.height = `${size}px`;
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = `${e.clientX}px`; 
        p.style.top = `${e.clientY}px`;
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 100 + 50;
        p.style.setProperty('--dx', `${Math.cos(angle) * velocity}px`);
        p.style.setProperty('--dy', `${Math.sin(angle) * velocity}px`);
        setTimeout(() => p.remove(), 600);
    }
});

// --- 3. 3D 悬浮卡片逻辑 ---
document.addEventListener('DOMContentLoaded', () => {
    const visualArea = document.getElementById('visual-area');
    const card = document.getElementById('tilt-card');
    
    if(visualArea && card && window.matchMedia("(min-width: 900px)").matches) {
        visualArea.addEventListener('mousemove', (e) => {
            const rect = visualArea.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const xPct = (x / rect.width - 0.5) * 2; 
            const yPct = (y / rect.height - 0.5) * 2;
            // 限制旋转角度
            card.style.transform = `perspective(1000px) rotateX(${yPct * -8}deg) rotateY(${xPct * 8}deg) scale(1.02)`;
        });
        visualArea.addEventListener('mouseleave', () => {
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)`;
        });
    }
});
