/**
 * ============================================================
 * 模块名称：App Main
 * 模块功能：管理网站核心交互逻辑、Live2D 模型加载与粒子系统
 * 依赖模块：PIXI.js, Live2D SDK (通过 Global window 对象)
 * ============================================================
 */

/* ==================== CONFIGURATION ==================== */
const APP_CONFIG = {
    modelPath: 'Live2d/33/33.default.model.json',
    colors: ['#FB7299', '#00A1D6', '#FFD700'],
    words: [
        "戳我干嘛呀？快去安装脚本！(≧∇≦)ﾉ",
        "这是全能护盾的官网哦！",
        "御坂网络连接正常...",
        "不要乱动人家啦！",
        "广告什么的，最讨厌了！",
        "今天也要元气满满哦！"
    ]
};

/**
 * 粒子系统管理器
 * @class ParticleSystem
 * @description 处理点击时的粒子爆炸效果
 */
class ParticleSystem {
    constructor() {
        this.bindEvents();
    }

    bindEvents() {
        document.addEventListener('click', (e) => this.spawn(e));
    }

    /**
     * 生成粒子
     * @param {MouseEvent} e - 鼠标事件对象
     */
    spawn(e) {
        // 如果点击的是 Canvas (模型)，交由 Live2DManager 处理，避免冲突
        if (e.target.tagName === 'CANVAS') return;

        for (let i = 0; i < 8; i++) {
            const p = document.createElement('div');
            p.classList.add('particle');
            document.body.appendChild(p);

            // 随机大小和颜色
            const size = Math.random() * 8 + 4;
            const color = APP_CONFIG.colors[Math.floor(Math.random() * APP_CONFIG.colors.length)];
            
            p.style.width = `${size}px`;
            p.style.height = `${size}px`;
            p.style.background = color;
            p.style.left = `${e.clientX}px`;
            p.style.top = `${e.clientY}px`;

            // 计算飞溅轨迹
            const angle = Math.random() * Math.PI * 2;
            const velocity = Math.random() * 100 + 50;
            p.style.setProperty('--dx', `${Math.cos(angle) * velocity}px`);
            p.style.setProperty('--dy', `${Math.sin(angle) * velocity}px`);

            // 动画结束后清理
            setTimeout(() => p.remove(), 600);
        }
    }
}

/**
 * 3D 悬浮卡片效果
 * @class TiltCard
 * @description 处理 Hero 区域的盾牌面板跟随鼠标倾斜效果
 */
class TiltCard {
    constructor() {
        this.visualArea = document.getElementById('visual-area');
        this.card = document.getElementById('tilt-card');
        this.init();
    }

    init() {
        if (!this.visualArea || !this.card) return;

        // 仅在桌面端启用
        if (window.matchMedia("(min-width: 900px)").matches) {
            this.visualArea.addEventListener('mousemove', (e) => this.handleMove(e));
            this.visualArea.addEventListener('mouseleave', () => this.handleLeave());
        }
    }

    handleMove(e) {
        const rect = this.visualArea.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 计算百分比 (-1 到 1)
        const xPct = (x / rect.width - 0.5) * 2;
        const yPct = (y / rect.height - 0.5) * 2;
        
        // 限制最大旋转角度
        this.card.style.transform = `perspective(1000px) rotateX(${yPct * -8}deg) rotateY(${xPct * 8}deg) scale(1.02)`;
    }

    handleLeave() {
        this.card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)`;
    }
}

/**
 * Live2D 模型管理器
 * @class Live2DManager
 * @description 封装 PIXI 应用及 Live2D 模型加载逻辑
 */
class Live2DManager {
    constructor() {
        this.loader = document.getElementById('loader');
        this.statusDiv = document.getElementById('loader-status');
        this.bubble = document.getElementById('speech-bubble');
        this.container = document.getElementById('live2d-container');
        this.canvas = document.getElementById('live2d-canvas');
        this.bubbleTimer = null;
        this.lastTapTime = 0; // 用于防抖
    }

    async init() {
        // 环境检查
        if (window.location.protocol === 'file:') {
            this.handleError("请使用 Local Server (如 VSCode Live Server) 运行！");
            return;
        }

        const rect = this.container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const dpr = window.devicePixelRatio || 1;

        // 设置 Canvas 物理像素
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        // 初始化 PIXI Application
        this.app = new PIXI.Application({
            view: this.canvas,
            autoStart: true,
            backgroundAlpha: 0,
            width: width,
            height: height,
            resolution: dpr,
            autoDensity: true
        });

        try {
            await this.loadModel(width, height);
            this.hideLoader();
        } catch (error) {
            console.error("Live2D Load Error:", error);
            this.handleError("模型加载失败，请检查网络或路径");
            this.hideLoader(2000); // 即使失败也进入页面
        }
    }

    async loadModel(containerWidth, containerHeight) {
        const model = await PIXI.live2d.Live2DModel.from(APP_CONFIG.modelPath);
        this.app.stage.addChild(model);

        // --- 适配逻辑 ---
        const modelWidth = model.internalModel.width;
        const modelHeight = model.internalModel.height;
        
        // 计算缩放：保持比例适应容器
        const scaleX = containerWidth / modelWidth;
        const scaleY = containerHeight / modelHeight;
        const scale = Math.min(scaleX, scaleY) * 0.9; 

        model.scale.set(scale);
        
        // 设置锚点为底部中心，并定位
        model.anchor.set(0.5, 1);
        model.x = containerWidth / 2;
        model.y = containerHeight;

        // --- 交互设置 (关键修复部分) ---
        model.interactive = true;
        model.buttonMode = true;
        
        // 设置 PIXI 内部点击区域 (作为备用)
        model.hitArea = new PIXI.Rectangle(
            -containerWidth / 2, 
            -containerHeight, 
            containerWidth, 
            containerHeight
        );

        // --- 统一的触发处理函数 ---
        const triggerInteraction = (e) => {
            // 防抖动：避免双重触发 (例如 click 和 pointertap 同时发生)
            const now = Date.now();
            if (now - this.lastTapTime < 300) return; 
            this.lastTapTime = now;

            console.log("🎯 Live2D 交互触发");
            this.handleTap(model);
        };

        // 1. 绑定 PIXI 内部事件 (兼容性好)
        model.on('pointertap', triggerInteraction);

        // 2. 绑定原生 Canvas 点击事件 (强制修复无法说话的问题)
        // 这确保了即使 PIXI 的 hitArea 计算有误，只要点击了 Canvas 区域就能触发
        this.canvas.addEventListener('click', (e) => {
            triggerInteraction(e);
        });

        // 3. 移动端触摸处理
        this.canvas.addEventListener('touchend', (e) => {
            // e.preventDefault(); // 视情况开启，防止同时触发 click
            triggerInteraction(e);
        }, { passive: false });

        console.log("✅ Live2D Initialized");
    }

    handleTap(model) {
        // 1. 播放随机动作 (优先尝试 tap_body，如果没有则尝试随机 idle)
        try {
            model.motion('tap_body');
        } catch (e) {
            console.warn("动作播放失败", e);
        }
        
        // 2. 显示气泡
        const text = APP_CONFIG.words[Math.floor(Math.random() * APP_CONFIG.words.length)];
        this.showBubble(text);
    }

    showBubble(text) {
        this.bubble.innerText = text;
        this.bubble.classList.add('speech-bubble--visible');
        
        if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
        this.bubbleTimer = setTimeout(() => {
            this.bubble.classList.remove('speech-bubble--visible');
        }, 3000);
    }

    handleError(msg) {
        if (this.statusDiv) {
            this.statusDiv.innerText = msg;
            this.statusDiv.style.color = "#ff5d5d";
        }
    }

    hideLoader(delay = 800) {
        setTimeout(() => {
            this.loader.classList.add('loader--hidden');
        }, delay);
    }
}

/**
 * 应用初始化
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. 启动 3D 卡片
    new TiltCard();
    
    // 2. 启动粒子系统
    new ParticleSystem();

    // 3. 启动 Live2D (需要等待外部库加载)
    const initLive2D = () => {
        if (window.PIXI && window.PIXI.live2d) {
            new Live2DManager().init();
        } else {
            // 如果库还没加载完，轮询检查 (简单的 fallback)
            setTimeout(initLive2D, 100);
        }
    };
    initLive2D();
});