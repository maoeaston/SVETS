# 特殊青少年职业能力发展系统 — 技术设计文档 (TDD)

## 确认决策摘要

| # | 决策点 | 您的确认 | 架构影响 |
|---|:---|:---|:---|
| 1 | 第一期仅交付"超市理货"模块，但底层架构需支撑后续所有模块 | ? | 引擎+插件架构，模块注册机制 |
| 2 | 教师管理界面嵌入同一个 Electron 应用中（PIN切换角色） | ? | 单应用双视图，角色路由隔离 |
| 3 | 训练素材是用模拟数据（系统内置图库），V2 再考虑对接 | ? | 内置资源包，预留外部数据源接口 |
| 4 | 后续要增加摄像头（可能会用Google的MediaPipe库） | ? | 预留硬件抽象层 + MediaPipe 集成接口 |
| 5 | 不用多语言，前期只考虑单机部署 | ? | 去掉 i18n / 云同步，极简部署 |

---

## 一、项目目录结构（完整工程蓝图）

```
vocational-training-system/
│
├── README.md
├── package.json                          # 顶层 monorepo 管理
├── pnpm-workspace.yaml
│
├── apps/
│   ├── electron-shell/                   # Electron 主进程
│   │   ├── package.json
│   │   ├── electron-builder.config.js    # 打包配置
│   │   ├── src/
│   │   │   ├── main.ts                   # Electron 主进程入口
│   │   │   ├── preload.ts                # 预加载脚本（IPC桥接）
│   │   │   ├── ipc-handlers/
│   │   │   │   ├── index.ts
│   │   │   │   ├── auth.ipc.ts           # PIN验证
│   │   │   │   ├── hardware.ipc.ts       # 硬件控制（摄像头预留）
│   │   │   │   └── window.ipc.ts         # 全屏/锁定控制
│   │   │   ├── services/
│   │   │   │   ├── auto-launch.ts        # 开机自启
│   │   │   │   ├── kiosk-mode.ts         # Kiosk锁定模式
│   │   │   │   └── backend-process.ts    # FastAPI 子进程管理
│   │   │   └── utils/
│   │   │       └── paths.ts              # 路径常量
│   │   └── resources/
│   │       └── icon.ico
│   │
│   └── frontend/                         # React 前端
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx                  # React 入口
│       │   ├── App.tsx                   # 根路由
│       │   │
│       │   ├── core/                     # 核心引擎层（跨模块共享）
│       │   │   ├── engines/
│       │   │   │   ├── adaptive-engine.ts        # 自适应难度引擎
│       │   │   │   ├── prompt-fading-engine.ts   # 辅助递减引擎
│       │   │   │   ├── scoring-engine.ts         # 统一计分引擎
│       │   │   │   └── session-manager.ts        # 会话管理器
│       │   │   ├── state/
│       │   │   │   ├── training-state-machine.ts # 训练状态机
│       │   │   │   ├── app-store.ts              # Zustand 全局状态
│       │   │   │   └── auth-store.ts             # 角色/PIN 状态
│       │   │   ├── hooks/
│       │   │   │   ├── usePointerDrag.ts         # Pointer Events 拖拽 Hook
│       │   │   │   ├── useTimer.ts               # 计时器 Hook
│       │   │   │   ├── useTTS.ts                 # 语音播报 Hook
│       │   │   │   ├── useAdaptive.ts            # 自适应难度 Hook
│       │   │   │   └── useBehaviorTracker.ts     # 行为事件追踪 Hook
│       │   │   ├── api/
│       │   │   │   ├── client.ts                 # Axios/Fetch 封装
│       │   │   │   ├── students.api.ts
│       │   │   │   ├── sessions.api.ts
│       │   │   │   ├── tasks.api.ts
│       │   │   │   └── reports.api.ts
│       │   │   └── types/
│       │   │       ├── index.ts
│       │   │       ├── student.types.ts
│       │   │       ├── task.types.ts
│       │   │       ├── module.types.ts
│       │   │       └── assessment.types.ts
│       │   │
│       │   ├── interaction-components/   # 交互引擎组件库（核心复用层）
│       │   │   ├── DragToZone/
│       │   │   │   ├── DragToZone.tsx
│       │   │   │   ├── DragToZone.test.tsx
│       │   │   │   └── types.ts
│       │   │   ├── DragToSort/
│       │   │   │   ├── DragToSort.tsx
│       │   │   │   └── types.ts
│       │   │   ├── TapSelect/
│       │   │   │   ├── TapSelect.tsx
│       │   │   │   └── types.ts
│       │   │   ├── CountAndConfirm/
│       │   │   │   ├── CountAndConfirm.tsx
│       │   │   │   └── types.ts
│       │   │   ├── DrawBBox/              # V3: AI标注专用
│       │   │   │   ├── DrawBBox.tsx
│       │   │   │   └── types.ts
│       │   │   ├── TapPoint/              # V3: AI标注专用
│       │   │   │   ├── TapPoint.tsx
│       │   │   │   └── types.ts
│       │   │   ├── SequentialSteps/
│       │   │   │   ├── SequentialSteps.tsx
│       │   │   │   └── types.ts
│       │   │   └── shared/
│       │   │       ├── FeedbackOverlay.tsx    # 正确/重试 反馈层
│       │   │       ├── ProgressBar.tsx        # 进度条
│       │   │       ├── VisualTimer.tsx        # 可视化计时器
│       │   │       └── RewardAnimation.tsx    # 正向激励动画
│       │   │
│       │   ├── modules/                  # 职业模块（可插拔）
│       │   │   ├── module-registry.ts    # 模块注册中心
│       │   │   ├── shelf-stocking/       # 超市理货（第一期）
│       │   │   │   ├── index.ts          # 模块注册入口
│       │   │   │   ├── config.ts         # 技能维度 + 难度配置
│       │   │   │   ├── assets/           # 模块专属素材
│       │   │   │   │   ├── images/
│       │   │   │   │   │   ├── products/     # 商品图片
│       │   │   │   │   │   ├── shelves/      # 货架图片
│       │   │   │   │   │   └── damaged/      # 临损品图片
│       │   │   │   │   └── videos/
│       │   │   │   │       ├── demo-sorting.mp4
│       │   │   │   │       └── demo-stocking.mp4
│       │   │   │   ├── tasks/
│       │   │   │   │   ├── product-sorting.tasks.ts
│       │   │   │   │   ├── shelf-arrangement.tasks.ts
│       │   │   │   │   └── damage-detection.tasks.ts
│       │   │   │   ├── baseline/
│       │   │   │   │   └── probes.ts     # 基线评估探测配置
│       │   │   │   └── pages/
│       │   │   │       ├── ShelfStockingHome.tsx
│       │   │   │       └── TrainingFlow.tsx
│       │   │   │
│       │   │   ├── packaging-sorting/    # 包装分拣（第二期·占位）
│       │   │   │   ├── index.ts
│       │   │   │   └── config.ts
│       │   │   │
│       │   │   ├── ai-data-annotation/   # AI标注（第三期·占位）
│       │   │   │   ├── index.ts
│       │   │   │   └── config.ts
│       │   │   │
│       │   │   └── handicraft-making/    # 手工制作（第三期·占位）
│       │   │       ├── index.ts
│       │   │       └── config.ts
│       │   │
│       │   ├── views/                    # 页面视图
│       │   │   ├── student/              # 学生端视图
│       │   │   │   ├── StudentLogin.tsx       # 学生选择（大头像列表）
│       │   │   │   ├── ModuleSelect.tsx       # 职业模块选择
│       │   │   │   ├── TrainingSession.tsx    # 训练会话主容器
│       │   │   │   ├── BaselineProbe.tsx      # 基线评估
│       │   │   │   ├── SessionComplete.tsx    # 训练完成/奖励
│       │   │   │   └── SOSCenter.tsx          # 情绪支持中心
│       │   │   │
│       │   │   └── teacher/              # 教师端视图
│       │   │       ├── TeacherDashboard.tsx    # 教师主控台
│       │   │       ├── StudentManagement.tsx   # 学生建档管理
│       │   │       ├── PlanAssignment.tsx      # 训练计划分配
│       │   │       ├── SessionMonitor.tsx      # 实时训练监控
│       │   │       ├── ProgressReport.tsx      # 能力进展报告
│       │   │       ├── GeneralizationVerify.tsx # 泛化实操验收
│       │   │       └── SystemSettings.tsx      # 系统设置
│       │   │
│       │   ├── layouts/
│       │   │   ├── StudentLayout.tsx      # 学生端布局（大按钮、SOS常驻）
│       │   │   └── TeacherLayout.tsx      # 教师端布局（侧边栏导航）
│       │   │
│       │   └── styles/
│       │       ├── globals.css
│       │       └── accessibility.css      # 无障碍样式变量
│       │
│       └── public/
│           └── fonts/                     # 大字体字体文件
│
├── backend/                              # Python FastAPI 后端
│   ├── pyproject.toml                    # Poetry/PDM 依赖管理
│   ├── alembic.ini                       # 数据库迁移配置
│   ├── alembic/
│   │   └── versions/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                       # FastAPI 入口
│   │   ├── config.py                     # 配置（DB路径等）
│   │   ├── database.py                   # SQLite 连接管理
│   │   │
│   │   ├── models/                       # SQLAlchemy ORM
│   │   │   ├── __init__.py
│   │   │   ├── student.py
│   │   │   ├── operator.py
│   │   │   ├── vocational_module.py
│   │   │   ├── skill_dimension.py
│   │   │   ├── assessment.py
│   │   │   ├── training_plan.py
│   │   │   ├── training_session.py
│   │   │   ├── task_result.py
│   │   │   ├── behavior_event.py
│   │   │   ├── generalization_record.py
│   │   │   └── ability_snapshot.py
│   │   │
│   │   ├── schemas/                      # Pydantic 数据校验
│   │   │   ├── __init__.py
│   │   │   ├── student.py
│   │   │   ├── session.py
│   │   │   ├── task.py
│   │   │   ├── assessment.py
│   │   │   └── report.py
│   │   │
│   │   ├── routers/                      # API 路由
│   │   │   ├── __init__.py
│   │   │   ├── auth.py                   # PIN 验证
│   │   │   ├── students.py
│   │   │   ├── operators.py
│   │   │   ├── modules.py               # 模块注册/查询
│   │   │   ├── assessments.py
│   │   │   ├── plans.py
│   │   │   ├── sessions.py
│   │   │   ├── tasks.py
│   │   │   ├── behaviors.py
│   │   │   ├── generalizations.py
│   │   │   └── reports.py               # 报告生成
│   │   │
│   │   ├── services/                     # 业务逻辑层
│   │   │   ├── __init__.py
│   │   │   ├── adaptive_engine.py        # 自适应难度算法
│   │   │   ├── prompt_fading.py          # 辅助递减逻辑
│   │   │   ├── mastery_evaluator.py      # 掌握标准判定
│   │   │   ├── ability_aggregator.py     # 底层能力聚合
│   │   │   ├── transfer_analyzer.py      # 跨职业迁移分析
│   │   │   └── report_generator.py       # 报告生成
│   │   │
│   │   ├── hardware/                     # 硬件抽象层（V2预留）
│   │   │   ├── __init__.py
│   │   │   ├── base.py                   # 硬件接口抽象基类
│   │   │   ├── camera.py                 # 摄像头接口（V2: MediaPipe）
│   │   │   └── stub.py                   # V1: 空实现/Mock
│   │   │
│   │   └── seed/                         # 初始数据
│   │       ├── __init__.py
│   │       ├── seed_modules.py           # 预注册职业模块
│   │       └── seed_demo_data.py         # 演示数据
│   │
│   └── tests/
│       ├── test_adaptive_engine.py
│       ├── test_mastery_evaluator.py
│       └── test_api_sessions.py
│
├── shared/                               # 前后端共享类型/常量
│   ├── constants/
│   │   ├── skill-dimensions.ts           # 技能维度ID常量
│   │   ├── interaction-types.ts          # 交互类型枚举
│   │   └── prompt-levels.ts             # 辅助等级枚举
│   └── interfaces/
│       └── module-interface.ts           # 模块接口定义
│
├── scripts/
│   ├── build-all.sh                      # 一键构建
│   ├── dev.sh                            # 开发启动脚本
│   ├── package-installer.sh              # 打包为安装程序
│   └── reset-database.sh                # 重置数据库
│
├── docs/
│   ├── PRD.md                            # 产品需求文档
│   ├── TDD.md                            # 技术设计文档（本文件）
│   ├── deployment-guide.md              # 部署指南
│   ├── teacher-manual.md                # 教师操作手册
│   └── module-development-guide.md      # 新模块开发指南
│
└── .github/                              # CI/CD（可选，本地开发为主）
    └── workflows/
        └── build.yml
```

---

## 二、核心代码实现

### 2.1 Electron 主进程

```typescript
// apps/electron-shell/src/main.ts

import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { setupIPCHandlers } from './ipc-handlers';
import { setupKioskMode } from './services/kiosk-mode';
import { startBackendProcess } from './services/backend-process';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

// 单实例锁：防止重复打开
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,          // 无边框（Kiosk模式）
    kiosk: true,           // Kiosk 模式
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 安全性：限制导航
      webSecurity: true,
    },
  });

  // 禁止学生通过快捷键退出
  setupKioskMode(mainWindow);

  // 开发环境加载 Vite Dev Server
  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 生产环境加载打包后的前端
    await mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
}

async function bootstrap() {
  // 1. 启动 FastAPI 后端子进程
  backendProcess = await startBackendProcess();

  // 2. 等待后端就绪
  await waitForBackendReady('http://127.0.0.1:8000/health', 30000);

  // 3. 创建窗口
  await createWindow();

  // 4. 注册 IPC 处理器
  setupIPCHandlers(ipcMain);
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  app.quit();
});

// 健康检查轮询
async function waitForBackendReady(url: string, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 后端还没起来，继续等
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Backend failed to start within timeout');
}
```

```typescript
// apps/electron-shell/src/services/backend-process.ts

import { spawn, ChildProcess } from 'child_process';
import path from 'path';

export function startBackendProcess(): ChildProcess {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // 开发环境：直接调用 uvicorn
    return spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], {
      cwd: path.join(__dirname, '../../../../backend'),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: 'pipe',
    });
  } else {
    // 生产环境：调用 PyInstaller 打包的可执行文件
    const backendExe = path.join(process.resourcesPath, 'backend', 'backend.exe');
    return spawn(backendExe, [], {
      stdio: 'pipe',
      env: { ...process.env, DB_PATH: path.join(app.getPath('userData'), 'data.db') },
    });
  }
}
```

```typescript
// apps/electron-shell/src/services/kiosk-mode.ts

import { BrowserWindow, globalShortcut } from 'electron';

export function setupKioskMode(win: BrowserWindow) {
  // 禁用常见退出快捷键
  const blockedKeys = [
    'Alt+F4', 'Alt+Tab', 'CommandOrControl+W',
    'CommandOrControl+Q', 'F11', 'Escape'
  ];

  win.on('focus', () => {
    blockedKeys.forEach(key => {
      globalShortcut.register(key, () => {
        // 吃掉按键，不执行任何操作
      });
    });
  });

  win.on('blur', () => {
    globalShortcut.unregisterAll();
  });

  // 只有教师通过 PIN 验证后才能解锁退出
  // 通过 IPC 从前端触发
}
```

```typescript
// apps/electron-shell/src/preload.ts

import { contextBridge, ipcRenderer } from 'electron';

// 暴露安全的 API 给前端
contextBridge.exposeInMainWorld('electronAPI', {
  // 角色验证
  verifyTeacherPIN: (pin: string) => ipcRenderer.invoke('auth:verify-pin', pin),

  // 系统控制
  exitKioskMode: () => ipcRenderer.invoke('window:exit-kiosk'),
  enterKioskMode: () => ipcRenderer.invoke('window:enter-kiosk'),

  // 硬件（V2预留）
  hardware: {
    isCameraAvailable: () => ipcRenderer.invoke('hardware:camera-check'),
    startCamera: () => ipcRenderer.invoke('hardware:camera-start'),
    stopCamera: () => ipcRenderer.invoke('hardware:camera-stop'),
    captureFrame: () => ipcRenderer.invoke('hardware:camera-capture'),
  },

  // 文件操作（导出报告用）
  saveFile: (data: string, filename: string) => ipcRenderer.invoke('file:save', data, filename),
});
```

---

### 2.2 FastAPI 后端核心

```python
# backend/app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import engine, Base, get_db
from app.routers import (
    auth, students, operators, modules,
    assessments, plans, sessions, tasks,
    behaviors, generalizations, reports
)
from app.seed.seed_modules import seed_initial_modules

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭生命周期"""
    # 启动时：创建表 + 播种初始数据
    Base.metadata.create_all(bind=engine)
    seed_initial_modules()
    yield
    # 关闭时：清理资源

app = FastAPI(
    title="特殊青少年职业能力发展系统",
    description="支持多职业方向的评估与训练平台 API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS（仅允许本地前端访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 健康检查探针
@app.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}

# 注册路由
app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
app.include_router(students.router, prefix="/api/students", tags=["学生管理"])
app.include_router(operators.router, prefix="/api/operators", tags=["教师管理"])
app.include_router(modules.router, prefix="/api/modules", tags=["职业模块"])
app.include_router(assessments.router, prefix="/api/assessments", tags=["能力评估"])
app.include_router(plans.router, prefix="/api/plans", tags=["训练计划"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["训练会话"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["任务记录"])
app.include_router(behaviors.router, prefix="/api/behaviors", tags=["行为事件"])
app.include_router(generalizations.router, prefix="/api/generalizations", tags=["泛化验收"])
app.include_router(reports.router, prefix="/api/reports", tags=["报告生成"])
```

```python
# backend/app/database.py

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False},  # SQLite 多线程支持
    echo=settings.debug,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

```python
# backend/app/config.py

from pydantic_settings import BaseSettings
from pathlib import Path
import os

class Settings(BaseSettings):
    db_path: str = os.environ.get("DB_PATH", str(Path(__file__).parent.parent / "data.db"))
    debug: bool = os.environ.get("DEBUG", "false").lower() == "true"
    teacher_pin_hash: str = "1234"  # V1 简单PIN，生产环境建议哈希

    class Config:
        env_file = ".env"

settings = Settings()
```

```python
# backend/app/models/student.py

from sqlalchemy import Column, String, Integer, JSON, DateTime, func
from app.database import Base
import uuid

class Student(Base):
    __tablename__ = "students"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    avatar_seed = Column(Integer, default=0)
    age = Column(Integer)
    diagnosis = Column(String)  # 'ASD', 'ID', 'ASD_ID', 'Other'
    support_level = Column(Integer, default=2)  # 1-3
    sensory_profile = Column(JSON, default=dict)
    communication_mode = Column(String, default='verbal')
    enrolled_modules = Column(JSON, default=list)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

```python
# backend/app/models/training_session.py

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, func
from app.database import Base
import uuid

class TrainingSession(Base):
    __tablename__ = "training_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    student_id = Column(String, ForeignKey("students.id"), nullable=False)
    module_id = Column(String, ForeignKey("vocational_modules.module_id"), nullable=False)
    plan_id = Column(String, ForeignKey("training_plans.id"))
    started_at = Column(DateTime, server_default=func.now())
    ended_at = Column(DateTime, nullable=True)
    end_reason = Column(String)  # 'completed', 'timeout', 'sos_exit', 'teacher_stop', 'natural_break'
    total_tasks = Column(Integer, default=0)
    correct_tasks = Column(Integer, default=0)
    session_mood_start = Column(String, nullable=True)
    session_mood_end = Column(String, nullable=True)
```

```python
# backend/app/models/task_result.py

from sqlalchemy import Column, String, Integer, Boolean, Float, JSON, DateTime, ForeignKey, func
from app.database import Base
import uuid

class TaskResult(Base):
    __tablename__ = "task_results"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("training_sessions.id"), nullable=False)
    student_id = Column(String, ForeignKey("students.id"), nullable=False)
    skill_dimension_id = Column(String, ForeignKey("skill_dimensions.id"))
    task_template_id = Column(String)
    interaction_type = Column(String)  # "drag_to_zone", "tap_select", etc.
    difficulty_level = Column(Integer)
    task_config_snapshot = Column(JSON)
    is_correct = Column(Boolean)
    duration_seconds = Column(Float)
    attempts = Column(Integer, default=1)
    prompt_level = Column(String, default='independent')
    completed_at = Column(DateTime, server_default=func.now())
```

```python
# backend/app/models/behavior_event.py

from sqlalchemy import Column, String, JSON, DateTime, ForeignKey, func
from app.database import Base
import uuid

class BehaviorEvent(Base):
    __tablename__ = "behavior_events"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("training_sessions.id"), nullable=False)
    student_id = Column(String, ForeignKey("students.id"), nullable=False)
    event_type = Column(String, nullable=False)
    context_task_id = Column(String, nullable=True)
    context_skill = Column(String, nullable=True)
    timestamp = Column(DateTime, server_default=func.now())
    metadata = Column(JSON, default=dict)
```

```python
# backend/app/services/adaptive_engine.py

from typing import Optional, List
from sqlalchemy.orm import Session
from app.models.task_result import TaskResult
from app.models.behavior_event import BehaviorEvent
from app.models.training_plan import TrainingPlan

class AdaptiveEngine:
    """自适应难度引擎 —— 基于滑动窗口的能力评估"""

    WINDOW_SIZE = 5
    LEVEL_UP_THRESHOLD = 0.8
    LEVEL_DOWN_THRESHOLD = 0.4
    SOS_RATE_CONCERN = 2.0  # 每会话SOS超过2次视为困难

    def evaluate_and_adjust(
        self,
        db: Session,
        student_id: str,
        skill_dimension_id: str,
        plan_id: str
    ) -> dict:
        """
        评估学生当前能力并决定是否调整难度
        返回: {"action": "LEVEL_UP|LEVEL_DOWN|MAINTAIN", "new_level": int, "reason": str}
        """
        plan = db.query(TrainingPlan).filter_by(id=plan_id).first()
        if not plan:
            return {"action": "MAINTAIN", "new_level": 1, "reason": "plan_not_found"}

        # 获取最近N次该技能的任务结果
        recent_results: List[TaskResult] = (
            db.query(TaskResult)
            .filter_by(student_id=student_id, skill_dimension_id=skill_dimension_id)
            .order_by(TaskResult.completed_at.desc())
            .limit(self.WINDOW_SIZE)
            .all()
        )

        if len(recent_results) < self.WINDOW_SIZE:
            # 数据不足，保持当前级别
            return {
                "action": "MAINTAIN",
                "new_level": plan.current_level,
                "reason": f"数据不足（仅{len(recent_results)}/{self.WINDOW_SIZE}次）"
            }

        # 计算正确率
        success_rate = sum(1 for r in recent_results if r.is_correct) / len(recent_results)

        # 计算近期 SOS 频率
        recent_session_ids = list(set(r.session_id for r in recent_results))
        sos_count = (
            db.query(BehaviorEvent)
            .filter(
                BehaviorEvent.student_id == student_id,
                BehaviorEvent.session_id.in_(recent_session_ids),
                BehaviorEvent.event_type == 'sos_click'
            )
            .count()
        )
        sos_rate = sos_count / max(len(recent_session_ids), 1)

        # 决策逻辑
        current_level = plan.current_level

        if success_rate >= self.LEVEL_UP_THRESHOLD and sos_rate < 1.0:
            # 优秀表现 → 升级
            new_level = min(current_level + 1, 3)  # 最高L3
            if new_level > current_level:
                plan.current_level = new_level
                db.commit()
                return {
                    "action": "LEVEL_UP",
                    "new_level": new_level,
                    "reason": f"正确率{success_rate:.0%}，SOS率{sos_rate:.1f}，表现优秀"
                }

        elif success_rate < self.LEVEL_DOWN_THRESHOLD or sos_rate > self.SOS_RATE_CONCERN:
            # 困难/情绪问题 → 降级
            new_level = max(current_level - 1, 1)  # 最低L1
            if new_level < current_level:
                plan.current_level = new_level
                db.commit()
                return {
                    "action": "LEVEL_DOWN",
                    "new_level": new_level,
                    "reason": f"正确率{success_rate:.0%}或SOS率{sos_rate:.1f}过高，降低难度"
                }

        return {
            "action": "MAINTAIN",
            "new_level": current_level,
            "reason": f"正确率{success_rate:.0%}，继续巩固当前级别"
        }


class PromptFadingEngine:
    """辅助递减引擎"""

    FADING_STAGES = [
        'full_support',      # 全辅助：视频+高亮+语音逐步+自动纠正
        'partial_support',   # 部分辅助：高亮+延迟语音
        'minimal_support',   # 最低辅助：仅错误时语音
        'independent'        # 独立：无任何提示
    ]

    STAGE_ADVANCE_CRITERIA = {
        'full_support': {'consecutive_independent_correct': 3},
        'partial_support': {'consecutive_independent_correct': 3},
        'minimal_support': {'consecutive_independent_correct': 5},
    }

    def evaluate_fading(
        self,
        db: Session,
        student_id: str,
        plan_id: str
    ) -> dict:
        """评估是否应该减少辅助"""
        plan = db.query(TrainingPlan).filter_by(id=plan_id).first()
        if not plan:
            return {"stage": "full_support", "action": "MAINTAIN"}

        current_stage = plan.prompt_fading_stage
        stage_index = self.FADING_STAGES.index(current_stage)

        if stage_index >= len(self.FADING_STAGES) - 1:
            return {"stage": current_stage, "action": "MAINTAIN", "reason": "已达独立阶段"}

        # 获取当前辅助阶段下的连续正确次数
        recent_results = (
            db.query(TaskResult)
            .filter_by(student_id=student_id, skill_dimension_id=plan.skill_dimension_id)
            .filter(TaskResult.prompt_level == current_stage)
            .order_by(TaskResult.completed_at.desc())
            .limit(10)
            .all()
        )

        # 检查连续正确
        consecutive_correct = 0
        for r in recent_results:
            if r.is_correct:
                consecutive_correct += 1
            else:
                break

        criteria = self.STAGE_ADVANCE_CRITERIA.get(current_stage, {})
        required = criteria.get('consecutive_independent_correct', 3)

        if consecutive_correct >= required:
            new_stage = self.FADING_STAGES[stage_index + 1]
            plan.prompt_fading_stage = new_stage
            db.commit()
            return {
                "stage": new_stage,
                "action": "FADE",
                "reason": f"连续{consecutive_correct}次正确，辅助递减至{new_stage}"
            }

        return {
            "stage": current_stage,
            "action": "MAINTAIN",
            "reason": f"连续正确{consecutive_correct}/{required}，继续当前辅助级别"
        }
```

```python
# backend/app/services/mastery_evaluator.py

from sqlalchemy.orm import Session
from app.models.training_plan import TrainingPlan
from app.models.task_result import TaskResult
import json

class MasteryEvaluator:
    """掌握标准判定器"""

    def check_mastery(self, db: Session, plan_id: str) -> dict:
        """
        判断学生是否已掌握某个技能
        掌握标准（默认）：
        - 在最高难度(L3)下
        - 独立(independent)完成
        - 连续3次正确率≥80%
        """
        plan = db.query(TrainingPlan).filter_by(id=plan_id).first()
        if not plan:
            return {"mastered": False, "reason": "plan_not_found"}

        criteria = json.loads(plan.mastery_criteria) if isinstance(plan.mastery_criteria, str) else plan.mastery_criteria
        required_consecutive = criteria.get("consecutive_success", 3)
        min_accuracy = criteria.get("min_accuracy", 0.8)

        # 检查：是否已在最高级别 + 独立阶段
        if plan.current_level < 3:
            return {"mastered": False, "progress": f"当前L{plan.current_level}，目标L3"}

        if plan.prompt_fading_stage != 'independent':
            return {"mastered": False, "progress": f"辅助阶段：{plan.prompt_fading_stage}"}

        # 查最近 N 次在 L3 + independent 下的结果
        results = (
            db.query(TaskResult)
            .filter_by(
                student_id=plan.student_id,
                skill_dimension_id=plan.skill_dimension_id,
                difficulty_level=3,
                prompt_level='independent'
            )
            .order_by(TaskResult.completed_at.desc())
            .limit(required_consecutive * 5)  # 取5倍窗口计算
            .all()
        )

        if len(results) < required_consecutive:
            return {"mastered": False, "progress": f"独立L3数据不足"}

        # 按会话分组计算正确率
        # 简化：直接看连续正确
        consecutive_correct = 0
        for r in results:
            if r.is_correct:
                consecutive_correct += 1
                if consecutive_correct >= required_consecutive:
                    # 掌握！
                    plan.status = 'mastered'
                    db.commit()
                    return {"mastered": True, "reason": f"连续{consecutive_correct}次独立正确"}
            else:
                consecutive_correct = 0  # 中断重计

        return {"mastered": False, "progress": f"最佳连续正确：{consecutive_correct}/{required_consecutive}"}
```

```python
# backend/app/hardware/base.py
"""硬件抽象层 —— V2 MediaPipe 摄像头预留"""

from abc import ABC, abstractmethod
from typing import Optional
import numpy as np

class CameraInterface(ABC):
    """摄像头硬件接口（V2 实现，V1 使用 StubCamera）"""

    @abstractmethod
    def is_available(self) -> bool:
        pass

    @abstractmethod
    def start(self) -> bool:
        pass

    @abstractmethod
    def stop(self) -> None:
        pass

    @abstractmethod
    def capture_frame(self) -> Optional[np.ndarray]:
        pass


class MediaPipeAnalyzer(ABC):
    """MediaPipe 分析接口（V2 实现）"""

    @abstractmethod
    def analyze_hand_gesture(self, frame: np.ndarray) -> dict:
        """手势识别 —— 用于手工制作模块"""
        pass

    @abstractmethod
    def analyze_object_position(self, frame: np.ndarray) -> dict:
        """物体位置检测 —— 用于验证实物摆放"""
        pass
```

```python
# backend/app/hardware/stub.py
"""V1 硬件空实现"""

from app.hardware.base import CameraInterface, MediaPipeAnalyzer
from typing import Optional
import numpy as np

class StubCamera(CameraInterface):
    """V1 空实现：摄像头不可用"""

    def is_available(self) -> bool:
        return False

    def start(self) -> bool:
        return False

    def stop(self) -> None:
        pass

    def capture_frame(self) -> Optional[np.ndarray]:
        return None


class StubMediaPipeAnalyzer(MediaPipeAnalyzer):
    """V1 空实现"""

    def analyze_hand_gesture(self, frame: np.ndarray) -> dict:
        return {"available": False, "message": "Camera not available in V1"}

    def analyze_object_position(self, frame: np.ndarray) -> dict:
        return {"available": False, "message": "Camera not available in V1"}
```

---

### 2.3 前端核心引擎

```typescript
// apps/frontend/src/core/engines/session-manager.ts

import { api } from '../api/client';

export interface SessionConfig {
  studentId: string;
  moduleId: string;
  planId: string;
  maxTasks?: number;        // 单次会话最大任务数
  maxDuration?: number;     // 单次会话最大时长（分钟）
  breakInterval?: number;   // 每隔N个任务强制休息
}

export interface SessionState {
  sessionId: string;
  currentTaskIndex: number;
  totalTasks: number;
  correctTasks: number;
  startedAt: Date;
  isBreakTime: boolean;
}

export class SessionManager {
  private config: SessionConfig;
  private state: SessionState | null = null;
  private breakInterval: number;

  constructor(config: SessionConfig) {
    this.config = config;
    this.breakInterval = config.breakInterval ?? 5; // 默认每5题休息
  }

  async start(): Promise<SessionState> {
    // 创建会话记录
    const response = await api.post('/api/sessions', {
      student_id: this.config.studentId,
      module_id: this.config.moduleId,
      plan_id: this.config.planId,
    });

    this.state = {
      sessionId: response.data.id,
      currentTaskIndex: 0,
      totalTasks: 0,
      correctTasks: 0,
      startedAt: new Date(),
      isBreakTime: false,
    };

    return this.state;
  }

  async recordTaskResult(result: {
    isCorrect: boolean;
    durationSeconds: number;
    attempts: number;
    promptLevel: string;
    taskTemplateId: string;
    skillDimensionId: string;
    difficultyLevel: number;
    taskConfigSnapshot: object;
  }): Promise<void> {
    if (!this.state) throw new Error('Session not started');

    await api.post('/api/tasks', {
      session_id: this.state.sessionId,
      student_id: this.config.studentId,
      ...result,
    });

    this.state.totalTasks++;
    if (result.isCorrect) this.state.correctTasks++;
    this.state.currentTaskIndex++;

    // 检查是否需要休息
    if (this.state.currentTaskIndex % this.breakInterval === 0) {
      this.state.isBreakTime = true;
    }
  }

  async recordBehaviorEvent(event: {
    eventType: string;
    contextTaskId?: string;
    contextSkill?: string;
    metadata?: object;
  }): Promise<void> {
    if (!this.state) return;

    await api.post('/api/behaviors', {
      session_id: this.state.sessionId,
      student_id: this.config.studentId,
      ...event,
    });
  }

  async end(reason: string): Promise<void> {
    if (!this.state) return;

    await api.patch(`/api/sessions/${this.state.sessionId}`, {
      ended_at: new Date().toISOString(),
      end_reason: reason,
      total_tasks: this.state.totalTasks,
      correct_tasks: this.state.correctTasks,
    });

    this.state = null;
  }

  getState(): SessionState | null {
    return this.state;
  }

  shouldEnd(): boolean {
    if (!this.state) return true;

    const maxTasks = this.config.maxTasks ?? 15;
    const maxDuration = (this.config.maxDuration ?? 30) * 60 * 1000;
    const elapsed = Date.now() - this.state.startedAt.getTime();

    return this.state.totalTasks >= maxTasks || elapsed >= maxDuration;
  }
}
```

```typescript
// apps/frontend/src/core/engines/adaptive-engine.ts

import { api } from '../api/client';

export interface AdaptiveDecision {
  action: 'LEVEL_UP' | 'LEVEL_DOWN' | 'MAINTAIN';
  newLevel: number;
  reason: string;
}

export interface PromptFadingDecision {
  stage: 'full_support' | 'partial_support' | 'minimal_support' | 'independent';
  action: 'FADE' | 'MAINTAIN';
  reason: string;
}

export interface TaskGenerationParams {
  skillDimensionId: string;
  difficultyLevel: number;
  promptStage: string;
}

/**
 * 前端自适应引擎客户端
 * 实际计算在后端完成，前端负责请求和应用决策
 */
export class AdaptiveEngineClient {

  async getNextDifficulty(studentId: string, planId: string, skillDimensionId: string): Promise<AdaptiveDecision> {
    const response = await api.get('/api/plans/adaptive-check', {
      params: { student_id: studentId, plan_id: planId, skill_dimension_id: skillDimensionId }
    });
    return response.data;
  }

  async getPromptFadingStage(studentId: string, planId: string): Promise<PromptFadingDecision> {
    const response = await api.get('/api/plans/prompt-fading-check', {
      params: { student_id: studentId, plan_id: planId }
    });
    return response.data;
  }

  /**
   * 根据当前难度和辅助阶段，决定前端UI应该展示哪些辅助元素
   */
  getUIPromptConfig(stage: string): UIPromptConfig {
    const configs: Record<string, UIPromptConfig> = {
      'full_support': {
        showDemoVideo: true,
        showStepImages: true,
        highlightTargetZones: true,
        highlightIntensity: 'strong',    // 高亮闪烁
        ttsAutoPlay: true,
        ttsOnIdle: true,                  // 停滞5秒自动语音
        ttsIdleDelay: 3000,
        showHintArrow: true,
        autoCorrectOnError: true,         // 错误后自动演示正确操作
      },
      'partial_support': {
        showDemoVideo: false,
        showStepImages: true,
        highlightTargetZones: true,
        highlightIntensity: 'subtle',    // 轻微高亮
        ttsAutoPlay: false,
        ttsOnIdle: true,
        ttsIdleDelay: 5000,               // 停滞5秒后才语音
        showHintArrow: false,
        autoCorrectOnError: false,
      },
      'minimal_support': {
        showDemoVideo: false,
        showStepImages: false,
        highlightTargetZones: false,
        highlightIntensity: 'none',
        ttsAutoPlay: false,
        ttsOnIdle: false,
        ttsIdleDelay: 0,
        showHintArrow: false,
        autoCorrectOnError: false,
        // 仅在错误时给语音反馈
        ttsOnError: true,
      },
      'independent': {
        showDemoVideo: false,
        showStepImages: false,
        highlightTargetZones: false,
        highlightIntensity: 'none',
        ttsAutoPlay: false,
        ttsOnIdle: false,
        ttsIdleDelay: 0,
        showHintArrow: false,
        autoCorrectOnError: false,
        ttsOnError: false,
      },
    };
    return configs[stage] || configs['full_support'];
  }
}

export interface UIPromptConfig {
  showDemoVideo: boolean;
  showStepImages: boolean;
  highlightTargetZones: boolean;
  highlightIntensity: 'strong' | 'subtle' | 'none';
  ttsAutoPlay: boolean;
  ttsOnIdle: boolean;
  ttsIdleDelay: number;
  showHintArrow: boolean;
  autoCorrectOnError: boolean;
  ttsOnError?: boolean;
}
```

```typescript
// apps/frontend/src/core/hooks/usePointerDrag.ts

import { useCallback, useRef, useState } from 'react';

interface DragState {
  isDragging: boolean;
  dragItemId: string | null;
  currentX: number;
  currentY: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
}

interface UseDragOptions {
  onDragStart?: (itemId: string) => void;
  onDragMove?: (itemId: string, x: number, y: number) => void;
  onDragEnd?: (itemId: string, dropX: number, dropY: number) => void;
}

/**
 * 基于 Pointer Events 的拖拽 Hook
 * 
 * 设计原则：
 * 1. 绝对不使用 HTML5 Drag API（触控屏兼容性灾难）
 * 2. 使用 Pointer Events 统一处理鼠标/触控/笔
 * 3. 支持触控大屏的惯性和吸附
 */
export function usePointerDrag(options: UseDragOptions = {}) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    dragItemId: null,
    currentX: 0,
    currentY: 0,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
  });

  const elementRef = useRef<HTMLElement | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent, itemId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // 捕获指针，确保拖拽时移出元素仍能追踪
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    setDragState({
      isDragging: true,
      dragItemId: itemId,
      currentX: e.clientX - offsetX,
      currentY: e.clientY - offsetY,
      offsetX,
      offsetY,
      startX: rect.left,
      startY: rect.top,
    });

    options.onDragStart?.(itemId);
  }, [options]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.isDragging || !dragState.dragItemId) return;

    e.preventDefault();

    const newX = e.clientX - dragState.offsetX;
    const newY = e.clientY - dragState.offsetY;

    setDragState(prev => ({
      ...prev,
      currentX: newX,
      currentY: newY,
    }));

    options.onDragMove?.(dragState.dragItemId, newX, newY);
  }, [dragState.isDragging, dragState.dragItemId, dragState.offsetX, dragState.offsetY, options]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.isDragging || !dragState.dragItemId) return;

    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    options.onDragEnd?.(dragState.dragItemId, e.clientX, e.clientY);

    setDragState({
      isDragging: false,
      dragItemId: null,
      currentX: 0,
      currentY: 0,
      offsetX: 0,
      offsetY: 0,
      startX: 0,
      startY: 0,
    });
  }, [dragState.isDragging, dragState.dragItemId, options]);

  return {
    dragState,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
    },
    // 辅助方法：获取拖拽中元素的样式
    getDragStyle: (itemId: string): React.CSSProperties => {
      if (dragState.isDragging && dragState.dragItemId === itemId) {
        return {
          position: 'fixed',
          left: dragState.currentX,
          top: dragState.currentY,
          zIndex: 9999,
          transform: 'scale(1.05)',
          transition: 'transform 0.1s',
          touchAction: 'none',  // 关键：禁止触控屏默认的滚动行为
          userSelect: 'none',
        };
      }
      return { touchAction: 'none', userSelect: 'none' };
    },
    // 弹回动画样式
    getReturnStyle: (itemId: string): React.CSSProperties => ({
      transition: 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      touchAction: 'none',
      userSelect: 'none',
    }),
  };
}
```

```typescript
// apps/frontend/src/core/hooks/useTTS.ts

/**
 * 文字转语音 Hook
 * 使用浏览器原生 Web Speech API（Electron 环境下可用）
 */
export function useTTS() {
  const speak = useCallback((text: string, options?: { rate?: number; pitch?: number }) => {
    if (!window.speechSynthesis) return;

    // 停止之前的播报
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = options?.rate ?? 0.8;   // 稍慢语速，适合特殊学生
    utterance.pitch = options?.pitch ?? 1.0;
    utterance.volume = 1.0;

    // 优先选择中文语音
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) utterance.voice = zhVoice;

    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
  }, []);

  return { speak, stop };
}
```

```typescript
// apps/frontend/src/core/state/training-state-machine.ts

/**
 * 训练状态机 —— 控制学生端的完整训练流程
 * 
 * 核心原则：学生在任何时刻都只可能处于一个明确状态
 * 特殊学生最怕"不知道现在该干什么" —— 状态机确保永远清晰
 */

export type TrainingPhase =
  | { type: 'IDLE' }
  | { type: 'STUDENT_SELECT' }
  | { type: 'MODULE_SELECT'; studentId: string }
  | { type: 'MOOD_CHECK_IN'; studentId: string; moduleId: string }
  | { type: 'SESSION_BRIEFING'; sessionConfig: SessionBriefing }
  | { type: 'STEP_WATCH'; taskContext: TaskContext; videoUrl: string }
  | { type: 'STEP_LEARN'; taskContext: TaskContext; steps: LearningStep[] }
  | { type: 'STEP_PRACTICE'; taskContext: TaskContext; taskConfig: any }
  | { type: 'STEP_DO'; taskContext: TaskContext; checkpoints: string[] }
  | { type: 'TASK_FEEDBACK'; taskContext: TaskContext; isCorrect: boolean }
  | { type: 'REWARD'; rewardType: RewardType; taskContext: TaskContext }
  | { type: 'BREAK'; duration: number; returnPhase: TrainingPhase }
  | { type: 'SOS_ACTIVE'; returnPhase: TrainingPhase }
  | { type: 'SESSION_COMPLETE'; summary: SessionSummary }
  | { type: 'MOOD_CHECK_OUT'; summary: SessionSummary }

export type TrainingAction =
  | { type: 'SELECT_STUDENT'; studentId: string }
  | { type: 'SELECT_MODULE'; moduleId: string }
  | { type: 'MOOD_CHECKED'; mood: string }
  | { type: 'START_SESSION' }
  | { type: 'VIDEO_COMPLETE' }
  | { type: 'LEARNING_COMPLETE' }
  | { type: 'PRACTICE_COMPLETE'; isCorrect: boolean; result: any }
  | { type: 'GENERALIZATION_VERIFIED'; independenceLevel: string }
  | { type: 'REWARD_COMPLETE' }
  | { type: 'BREAK_COMPLETE' }
  | { type: 'NEXT_TASK' }
  | { type: 'TRIGGER_SOS' }
  | { type: 'SOS_RESOLVED' }
  | { type: 'SESSION_TIMEOUT' }
  | { type: 'TEACHER_STOP' }
  | { type: 'LOGOUT' }

export interface SessionBriefing {
  studentName: string;
  moduleName: string;
  todayTasks: number;
  estimatedMinutes: number;
}

export interface TaskContext {
  sessionId: string;
  skillDimensionId: string;
  taskIndex: number;
  totalTasks: number;
  difficultyLevel: number;
  promptStage: string;
}

export interface LearningStep {
  stepNumber: number;
  image: string;
  instruction: string;
  ttsText: string;
}

export type RewardType = 'star' | 'milestone' | 'level_up' | 'streak';

export interface SessionSummary {
  totalTasks: number;
  correctTasks: number;
  duration: number;
  starsEarned: number;
  newAchievements: string[];
}

/**
 * 状态机 Reducer
 */
export function trainingReducer(state: TrainingPhase, action: TrainingAction): TrainingPhase {
  switch (action.type) {
    case 'SELECT_STUDENT':
      return { type: 'MODULE_SELECT', studentId: action.studentId };

    case 'SELECT_MODULE':
      if (state.type !== 'MODULE_SELECT') return state;
      return { type: 'MOOD_CHECK_IN', studentId: state.studentId, moduleId: action.moduleId };

    case 'MOOD_CHECKED':
      if (state.type === 'MOOD_CHECK_IN') {
        return {
          type: 'SESSION_BRIEFING',
          sessionConfig: {
            studentName: '', // 由外部注入
            moduleName: '',
            todayTasks: 10,
            estimatedMinutes: 20,
          }
        };
      }
      if (state.type === 'MOOD_CHECK_OUT') {
        return { type: 'IDLE' };
      }
      return state;

    case 'TRIGGER_SOS':
      // SOS 可在任何训练阶段触发
      return { type: 'SOS_ACTIVE', returnPhase: state };

    case 'SOS_RESOLVED':
      if (state.type === 'SOS_ACTIVE') {
        return state.returnPhase;
      }
      return state;

    case 'PRACTICE_COMPLETE':
      if (state.type !== 'STEP_PRACTICE') return state;
      return {
        type: 'TASK_FEEDBACK',
        taskContext: state.taskContext,
        isCorrect: action.isCorrect,
      };

    case 'REWARD_COMPLETE':
      if (state.type !== 'REWARD') return state;
      // 检查是否需要休息或结束
      return { type: 'STEP_WATCH', taskContext: state.taskContext, videoUrl: '' }; // 简化

    case 'LOGOUT':
      return { type: 'IDLE' };

    default:
      return state;
  }
}
```

---

### 2.4 交互组件：DragToZone（核心拖拽分类组件）

```tsx
// apps/frontend/src/interaction-components/DragToZone/DragToZone.tsx

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePointerDrag } from '../../core/hooks/usePointerDrag';
import { useTTS } from '../../core/hooks/useTTS';
import { FeedbackOverlay } from '../shared/FeedbackOverlay';
import { UIPromptConfig } from '../../core/engines/adaptive-engine';

// ===== 类型定义 =====

export interface DragItem {
  id: string;
  label: string;
  imageUrl: string;
  correctZoneId: string;  // 正确的目标区域ID
}

export interface DropZone {
  id: string;
  label: string;
  imageUrl?: string;
  color: string;          // 区域背景色（柔和色系）
}

export interface DragToZoneProps {
  // 任务数据
  items: DragItem[];
  zones: DropZone[];

  // 辅助配置（由 Prompt Fading Engine 决定）
  promptConfig: UIPromptConfig;

  // 无障碍配置
  accessibility: {
    minTouchTarget: number;    // 最小触控尺寸 px
    fontSize: number;
    enableTTS: boolean;
  };

  // 回调
  onTaskComplete: (result: { isCorrect: boolean; attempts: number; duration: number }) => void;
  onBehaviorEvent: (event: { eventType: string; metadata?: object }) => void;

  // TTS 文案
  ttsTexts?: {
    instruction?: string;      // "请把商品拖到正确的位置"
    onCorrect?: string;        // "太棒了！放对了！"
    onIncorrect?: string;      // "放错位置啦，再试一次"
    onComplete?: string;       // "全部完成了！你真厉害！"
  };
}

// ===== 组件实现 =====

export function DragToZone({
  items,
  zones,
  promptConfig,
  accessibility,
  onTaskComplete,
  onBehaviorEvent,
  ttsTexts = {}
}: DragToZoneProps) {
  const { speak } = useTTS();

  // 状态
  const [placedItems, setPlacedItems] = useState<Record<string, string>>({}); // itemId → zoneId
  const [remainingItems, setRemainingItems] = useState<DragItem[]>(items);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<{ type: 'correct' | 'incorrect' | null; itemId?: string }>({ type: null });
  const [highlightedZone, setHighlightedZone] = useState<string | null>(null);

  const startTimeRef = useRef(Date.now());
  const zoneRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 初始 TTS 指令
  useEffect(() => {
    if (accessibility.enableTTS && promptConfig.ttsAutoPlay) {
      const instruction = ttsTexts.instruction || '请把物品拖到正确的位置';
      speak(instruction);
    }
  }, []);

  // 停滞检测（辅助提示）
  useEffect(() => {
    if (!promptConfig.ttsOnIdle || remainingItems.length === 0) return;

    const timer = setTimeout(() => {
      speak('试试把一个物品拖到右边的框里吧');
      onBehaviorEvent({ eventType: 'idle_timeout', metadata: { delay: promptConfig.ttsIdleDelay } });
    }, promptConfig.ttsIdleDelay);

    return () => clearTimeout(timer);
  }, [remainingItems, promptConfig.ttsOnIdle]);

  // 拖拽 Hook
  const { dragState, handlers, getDragStyle, getReturnStyle } = usePointerDrag({
    onDragStart: (itemId) => {
      // 如果有高亮提示，高亮正确的区域
      if (promptConfig.highlightTargetZones) {
        const item = items.find(i => i.id === itemId);
        if (item) setHighlightedZone(item.correctZoneId);
      }
    },
    onDragEnd: (itemId, dropX, dropY) => {
      setHighlightedZone(null);
      handleDrop(itemId, dropX, dropY);
    }
  });

  // 判断落点是否在某个区域内
  const getDropZone = useCallback((x: number, y: number): string | null => {
    for (const [zoneId, element] of zoneRefs.current.entries()) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return zoneId;
      }
    }
    return null;
  }, []);

  // 处理拖放结果
  const handleDrop = useCallback((itemId: string, dropX: number, dropY: number) => {
    const targetZoneId = getDropZone(dropX, dropY);
    const item = items.find(i => i.id === itemId);

    if (!item || !targetZoneId) {
      // 没有放到任何区域 → 平滑弹回（不计为错误）
      return;
    }

    setAttempts(prev => prev + 1);

    if (targetZoneId === item.correctZoneId) {
      // ? 正确！
      setFeedback({ type: 'correct', itemId });
      setPlacedItems(prev => ({ ...prev, [itemId]: targetZoneId }));
      setRemainingItems(prev => prev.filter(i => i.id !== itemId));

      if (accessibility.enableTTS) {
        speak(ttsTexts.onCorrect || '太棒了！放对了！');
      }

      // 检查是否全部完成
      const newRemaining = remainingItems.filter(i => i.id !== itemId);
      if (newRemaining.length === 0) {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        setTimeout(() => {
          if (accessibility.enableTTS) {
            speak(ttsTexts.onComplete || '全部完成了！你真厉害！');
          }
          onTaskComplete({
            isCorrect: true,
            attempts,
            duration,
          });
        }, 1500);
      }

      // 清除反馈
      setTimeout(() => setFeedback({ type: null }), 1200);

    } else {
      // ? 错误 → 平滑弹回原位，温和提示
      setFeedback({ type: 'incorrect', itemId });

      if (accessibility.enableTTS) {
        speak(ttsTexts.onIncorrect || '放错位置啦，再试一次');
      }

      // 如果是全辅助模式，自动演示正确位置
      if (promptConfig.autoCorrectOnError) {
        setTimeout(() => {
          setHighlightedZone(item.correctZoneId);
          speak(`这个应该放到${zones.find(z => z.id === item.correctZoneId)?.label}里`);
          setTimeout(() => setHighlightedZone(null), 2000);
        }, 1000);
      }

      // 清除反馈
      setTimeout(() => setFeedback({ type: null }), 1500);
    }
  }, [items, zones, remainingItems, attempts, accessibility, promptConfig, ttsTexts]);

  // ===== 渲染 =====

  const minSize = accessibility.minTouchTarget;
  const fontSize = accessibility.fontSize;

  return (
    <div className="relative w-full h-full flex flex-col p-6 select-none" style={{ touchAction: 'none' }}>

      {/* 顶部指令区 */}
      <div className="text-center mb-6">
        <h2 className="font-bold text-gray-800" style={{ fontSize: fontSize * 1.2 }}>
          请把物品拖到正确的位置
        </h2>
        {/* 进度指示 */}
        <div className="flex justify-center gap-2 mt-3">
          {items.map((item, index) => (
            <div
              key={item.id}
              className={`w-6 h-6 rounded-full transition-all ${
                placedItems[item.id] ? 'bg-green-400 scale-110' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 主交互区域 */}
      <div className="flex-1 flex gap-8">

        {/* 左侧：待拖拽物品 */}
        <div className="w-1/3 flex flex-col gap-4 items-center justify-center">
          {remainingItems.map(item => (
            <div
              key={item.id}
              className={`
                rounded-2xl border-4 border-dashed border-gray-300 
                bg-white shadow-lg cursor-grab active:cursor-grabbing
                flex flex-col items-center justify-center p-4
                transition-all hover:shadow-xl hover:scale-[1.02]
                ${feedback.type === 'incorrect' && feedback.itemId === item.id ? 'animate-shake' : ''}
              `}
              style={{
                minHeight: minSize,
                minWidth: minSize,
                ...getDragStyle(item.id),
              }}
              onPointerDown={(e) => handlers.onPointerDown(e, item.id)}
              onPointerMove={handlers.onPointerMove}
              onPointerUp={handlers.onPointerUp}
            >
              <img
                src={item.imageUrl}
                alt={item.label}
                className="w-20 h-20 object-contain pointer-events-none"
                draggable={false}
              />
              <span
                className="mt-2 font-semibold text-gray-700 pointer-events-none"
                style={{ fontSize }}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* 右侧：目标区域 */}
        <div className="w-2/3 flex flex-wrap gap-6 items-center justify-center">
          {zones.map(zone => (
            <div
              key={zone.id}
              ref={(el) => { if (el) zoneRefs.current.set(zone.id, el); }}
              className={`
                rounded-3xl border-4 p-6 flex flex-col items-center justify-center
                transition-all duration-300
                ${highlightedZone === zone.id 
                  ? 'border-blue-400 ring-4 ring-blue-200 scale-105 animate-pulse' 
                  : 'border-gray-200'
                }
              `}
              style={{
                minHeight: minSize * 1.5,
                minWidth: minSize * 1.5,
                backgroundColor: zone.color + '30', // 半透明背景
                borderColor: highlightedZone === zone.id ? '#60a5fa' : zone.color,
              }}
            >
              {zone.imageUrl && (
                <img src={zone.imageUrl} alt="" className="w-16 h-16 object-contain mb-2 opacity-60" draggable={false} />
              )}
              <span className="font-bold text-gray-600" style={{ fontSize }}>
                {zone.label}
              </span>

              {/* 已放置的物品展示 */}
              <div className="flex flex-wrap gap-2 mt-3">
                {Object.entries(placedItems)
                  .filter(([_, zId]) => zId === zone.id)
                  .map(([itemId]) => {
                    const placedItem = items.find(i => i.id === itemId);
                    return placedItem ? (
                      <div key={itemId} className="bg-white rounded-xl p-2 shadow-sm flex items-center gap-1">
                        <img src={placedItem.imageUrl} alt="" className="w-10 h-10 object-contain" draggable={false} />
                        <span className="text-green-500 text-xl">?</span>
                      </div>
                    ) : null;
                  })
                }
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 反馈覆盖层 */}
      {feedback.type === 'correct' && (
        <FeedbackOverlay type="success" />
      )}
    </div>
  );
}
```

```tsx
// apps/frontend/src/interaction-components/shared/FeedbackOverlay.tsx

import React, { useEffect, useState } from 'react';

interface FeedbackOverlayProps {
  type: 'success' | 'milestone' | 'level_up';
  duration?: number;
  onComplete?: () => void;
}

export function FeedbackOverlay({ type, duration = 1500, onComplete }: FeedbackOverlayProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
      <div className="animate-bounce-in">
        {type === 'success' && (
          <div className="text-center">
            <span className="text-9xl">?</span>
            <p className="text-4xl font-bold text-green-600 mt-4">太棒了！</p>
          </div>
        )}
        {type === 'milestone' && (
          <div className="text-center">
            <span className="text-9xl">?</span>
            <p className="text-4xl font-bold text-yellow-600 mt-4">获得一颗星星！</p>
          </div>
        )}
        {type === 'level_up' && (
          <div className="text-center">
            <span className="text-9xl">??</span>
            <p className="text-4xl font-bold text-purple-600 mt-4">升级啦！</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### 2.5 模块注册系统

```typescript
// apps/frontend/src/modules/module-registry.ts

import { VocationalModuleConfig } from '../core/types/module.types';

/**
 * 模块注册中心
 * 
 * 设计模式：服务定位器 (Service Locator)
 * 每个职业模块在 index.ts 中调用 registerModule() 完成注册
 * 前端根据已注册模块动态渲染UI
 */

class ModuleRegistry {
  private modules: Map<string, VocationalModuleConfig> = new Map();

  register(module: VocationalModuleConfig): void {
    if (this.modules.has(module.moduleId)) {
      console.warn(`Module "${module.moduleId}" already registered, overwriting.`);
    }
    this.modules.set(module.moduleId, module);
  }

  get(moduleId: string): VocationalModuleConfig | undefined {
    return this.modules.get(moduleId);
  }

  getAll(): VocationalModuleConfig[] {
    return Array.from(this.modules.values());
  }

  getActive(): VocationalModuleConfig[] {
    return this.getAll().filter(m => m.isActive);
  }
}

export const moduleRegistry = new ModuleRegistry();
```

```typescript
// apps/frontend/src/core/types/module.types.ts

export interface VocationalModuleConfig {
  moduleId: string;
  displayName: string;
  description: string;
  icon: string;
  color: string;           // 模块主色调
  isActive: boolean;       // 是否在当前版本激活
  version: string;

  // 技能维度定义
  skillDimensions: SkillDimensionConfig[];

  // 基线评估配置
  baselineProbes: BaselineProbeConfig[];

  // 训练任务模板
  taskTemplates: TaskTemplateConfig[];

  // 教学素材
  teachingMaterials: TeachingMaterialConfig[];
}

export interface SkillDimensionConfig {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  levelDescriptions: string[];
  underlyingAbilities: string[];
}

export interface TaskTemplateConfig {
  id: string;
  skillDimensionId: string;
  interactionType: string;  // 引用交互引擎类型
  difficultyConfigs: Record<number, DifficultyParams>;
  items: TaskItemConfig[];  // 该模板下的所有可用素材
}

export interface DifficultyParams {
  itemCount: number;
  zoneCount: number;
  distractorCount: number;
  timeLimit: number | null;
  [key: string]: any;      // 扩展字段
}

export interface TaskItemConfig {
  id: string;
  label: string;
  imageUrl: string;
  correctZoneId: string;
  difficulty: number;      // 该素材适用的难度等级
  tags: string[];
}

export interface BaselineProbeConfig {
  id: string;
  skillDimensionId: string;
  interactionType: string;
  instruction: string;
  ttsText: string;
  items: TaskItemConfig[];
  // 评估逻辑：根据完成情况自动判定初始等级
  scoringRules: {
    levelThresholds: { minCorrect: number; assignedLevel: number }[];
  };
}

export interface TeachingMaterialConfig {
  skillDimensionId: string;
  level: number;
  demoVideoUrl?: string;
  steps: {
    stepNumber: number;
    imageUrl: string;
    instruction: string;
    ttsText: string;
  }[];
}
```

```typescript
// apps/frontend/src/modules/shelf-stocking/index.ts

import { moduleRegistry } from '../module-registry';
import { VocationalModuleConfig } from '../../core/types/module.types';

const shelfStockingModule: VocationalModuleConfig = {
  moduleId: 'shelf_stocking',
  displayName: '超市理货',
  description: '学习超市商品分类、货架整理和临损品检测',
  icon: '/modules/shelf-stocking/icon.svg',
  color: '#4CAF50',
  isActive: true,
  version: '1.0.0',

  skillDimensions: [
    {
      id: 'shelf_stocking.product_sorting',
      name: '商品分类',
      description: '能将商品按品类正确归入对应区域',
      maxLevel: 3,
      levelDescriptions: [
        'L0: 无法区分两类明显不同的商品',
        'L1: 能区分2类差异明显的商品（如水果vs饮料）',
        'L2: 能区分3-4类商品并正确归位',
        'L3: 能处理相似品类的细分归位',
      ],
      underlyingAbilities: ['visual_matching', 'category_recognition'],
    },
    {
      id: 'shelf_stocking.shelf_arrangement',
      name: '排面整理',
      description: '能按规则将商品整齐排列在货架上',
      maxLevel: 3,
      levelDescriptions: [
        'L0: 无法理解"对齐"的概念',
        'L1: 能将物品沿标线排成一排',
        'L2: 能按标签朝向一致排列',
        'L3: 能独立整理一组乱序的货架',
      ],
      underlyingAbilities: ['spatial_awareness', 'sequential_execution'],
    },
    {
      id: 'shelf_stocking.damage_detection',
      name: '临损检测',
      description: '能识别破损、变形、过期等异常商品',
      maxLevel: 3,
      levelDescriptions: [
        'L0: 无法识别明显破损的物品',
        'L1: 能识别显著物理损坏（漏液、压扁）',
        'L2: 能识别轻微损坏+日期过期',
        'L3: 能综合判断并决定处置方式',
      ],
      underlyingAbilities: ['anomaly_detection', 'visual_comparison'],
    },
    {
      id: 'shelf_stocking.restocking_procedure',
      name: '补货流程',
      description: '能按标准流程完成商品补货操作',
      maxLevel: 3,
      levelDescriptions: [
        'L0: 无法按顺序完成2步操作',
        'L1: 能在全程提示下完成3步补货流程',
        'L2: 能在部分提示下完成4步补货流程',
        'L3: 能独立完成完整补货SOP',
      ],
      underlyingAbilities: ['sequential_execution', 'working_memory'],
    },
  ],

  baselineProbes: [
    {
      id: 'shelf_stocking.baseline.sorting',
      skillDimensionId: 'shelf_stocking.product_sorting',
      interactionType: 'drag_to_zone',
      instruction: '帮小熊把东西放到对的地方吧！',
      ttsText: '帮小熊把东西放到对的地方吧！',
      items: [
        { id: 'probe_apple', label: '苹果', imageUrl: '/assets/products/apple.png', correctZoneId: 'zone_fruit', difficulty: 1, tags: ['fruit'] },
        { id: 'probe_milk', label: '牛奶', imageUrl: '/assets/products/milk.png', correctZoneId: 'zone_drink', difficulty: 1, tags: ['drink'] },
        { id: 'probe_banana', label: '香蕉', imageUrl: '/assets/products/banana.png', correctZoneId: 'zone_fruit', difficulty: 1, tags: ['fruit'] },
        { id: 'probe_cola', label: '可乐', imageUrl: '/assets/products/cola.png', correctZoneId: 'zone_drink', difficulty: 2, tags: ['drink'] },
        { id: 'probe_grape', label: '葡萄', imageUrl: '/assets/products/grape.png', correctZoneId: 'zone_fruit', difficulty: 2, tags: ['fruit'] },
        { id: 'probe_chips', label: '薯片', imageUrl: '/assets/products/chips.png', correctZoneId: 'zone_snack', difficulty: 3, tags: ['snack'] },
      ],
      scoringRules: {
        levelThresholds: [
          { minCorrect: 0, assignedLevel: 0 },
          { minCorrect: 2, assignedLevel: 1 },
          { minCorrect: 4, assignedLevel: 2 },
          { minCorrect: 6, assignedLevel: 3 },
        ],
      },
    },
  ],

  taskTemplates: [
    {
      id: 'shelf_stocking.sort_drag',
      skillDimensionId: 'shelf_stocking.product_sorting',
      interactionType: 'drag_to_zone',
      difficultyConfigs: {
        1: { itemCount: 3, zoneCount: 2, distractorCount: 0, timeLimit: null },
        2: { itemCount: 4, zoneCount: 3, distractorCount: 1, timeLimit: null },
        3: { itemCount: 6, zoneCount: 4, distractorCount: 2, timeLimit: 120 },
      },
      items: [
        // L1 素材
        { id: 'apple_01', label: '苹果', imageUrl: '/assets/products/apple.png', correctZoneId: 'zone_fruit', difficulty: 1, tags: ['fruit'] },
        { id: 'milk_01', label: '牛奶', imageUrl: '/assets/products/milk.png', correctZoneId: 'zone_drink', difficulty: 1, tags: ['drink'] },
        { id: 'bread_01', label: '面包', imageUrl: '/assets/products/bread.png', correctZoneId: 'zone_food', difficulty: 1, tags: ['food'] },
        // L2 素材
        { id: 'yogurt_01', label: '酸奶', imageUrl: '/assets/products/yogurt.png', correctZoneId: 'zone_drink', difficulty: 2, tags: ['drink'] },
        { id: 'orange_01', label: '橙子', imageUrl: '/assets/products/orange.png', correctZoneId: 'zone_fruit', difficulty: 2, tags: ['fruit'] },
        { id: 'chips_01', label: '薯片', imageUrl: '/assets/products/chips.png', correctZoneId: 'zone_snack', difficulty: 2, tags: ['snack'] },
        // L3 素材（相似品类细分）
        { id: 'whole_milk', label: '全脂牛奶', imageUrl: '/assets/products/whole_milk.png', correctZoneId: 'zone_dairy', difficulty: 3, tags: ['dairy'] },
        { id: 'skim_milk', label: '脱脂牛奶', imageUrl: '/assets/products/skim_milk.png', correctZoneId: 'zone_dairy', difficulty: 3, tags: ['dairy'] },
        { id: 'soy_milk', label: '豆奶', imageUrl: '/assets/products/soy_milk.png', correctZoneId: 'zone_plant_drink', difficulty: 3, tags: ['plant'] },
      ],
    },
    {
      id: 'shelf_stocking.damage_tap',
      skillDimensionId: 'shelf_stocking.damage_detection',
      interactionType: 'tap_select',
      difficultyConfigs: {
        1: { itemCount: 4, damagedCount: 1, damageType: 'obvious_physical', timeLimit: null },
        2: { itemCount: 6, damagedCount: 2, damageType: 'mixed', timeLimit: null },
        3: { itemCount: 8, damagedCount: 2, damageType: 'subtle', timeLimit: 90 },
      },
      items: [
        { id: 'damaged_milk_leak', label: '漏液牛奶', imageUrl: '/assets/damaged/milk_leak.png', correctZoneId: 'damaged', difficulty: 1, tags: ['leak'] },
        { id: 'crushed_box', label: '压扁纸盒', imageUrl: '/assets/damaged/crushed_box.png', correctZoneId: 'damaged', difficulty: 1, tags: ['crush'] },
        { id: 'expired_bread', label: '过期面包', imageUrl: '/assets/damaged/expired_bread.png', correctZoneId: 'damaged', difficulty: 2, tags: ['expired'] },
        { id: 'normal_apple', label: '正常苹果', imageUrl: '/assets/products/apple.png', correctZoneId: 'normal', difficulty: 1, tags: ['normal'] },
        { id: 'normal_milk', label: '正常牛奶', imageUrl: '/assets/products/milk.png', correctZoneId: 'normal', difficulty: 1, tags: ['normal'] },
      ],
    },
  ],

  teachingMaterials: [
    {
      skillDimensionId: 'shelf_stocking.product_sorting',
      level: 1,
      demoVideoUrl: '/assets/videos/sorting_demo_l1.mp4',
      steps: [
        { stepNumber: 1, imageUrl: '/assets/steps/sorting_step1.png', instruction: '看一看：这是什么商品？', ttsText: '第一步：看一看，这是什么商品？' },
        { stepNumber: 2, imageUrl: '/assets/steps/sorting_step2.png', instruction: '想一想：它应该放在哪里？', ttsText: '第二步：想一想，它应该放在哪一类？' },
        { stepNumber: 3, imageUrl: '/assets/steps/sorting_step3.png', instruction: '放一放：把它拖到正确的位置', ttsText: '第三步：放一放，把它拖到正确的位置' },
      ],
    },
  ],
};

// 注册模块
moduleRegistry.register(shelfStockingModule);

export default shelfStockingModule;
```

---

### 2.6 学生端核心视图

```tsx
// apps/frontend/src/views/student/StudentLogin.tsx

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';

/**
 * 学生选择页面
 * 
 * 设计原则：
 * - 大头像卡片，一页最多显示6个学生
 * - 不需要输入密码（学生认知负荷限制）
 * - 教师预先建档，学生只需点击自己的头像
 */
export function StudentLogin({ onSelect }: { onSelect: (studentId: string) => void }) {
  const { data: students, isLoading } = useQuery({
    queryKey: ['students'],
    queryFn: () => api.get('/api/students').then(r => r.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-blue-50">
        <div className="text-4xl text-blue-400 animate-pulse">正在加载...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-b from-blue-50 to-green-50 p-8">
      <h1 className="text-5xl font-bold text-gray-700 mb-12">
        你好！请点击你的头像 ??
      </h1>

      <div className="grid grid-cols-3 gap-8 max-w-4xl">
        {students?.map((student: any) => (
          <button
            key={student.id}
            onClick={() => onSelect(student.id)}
            className="
              flex flex-col items-center p-8 rounded-3xl
              bg-white shadow-lg hover:shadow-2xl
              transform hover:scale-105 transition-all duration-200
              border-4 border-transparent hover:border-blue-300
              focus:outline-none focus:ring-4 focus:ring-blue-200
            "
            style={{ minHeight: '180px', minWidth: '180px' }}
          >
            {/* 使用 DiceBear 或类似的确定性头像生成 */}
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-200 to-purple-200 flex items-center justify-center text-5xl mb-4">
              {getAvatarEmoji(student.avatar_seed)}
            </div>
            <span className="text-3xl font-bold text-gray-700">
              {student.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function getAvatarEmoji(seed: number): string {
  const emojis = ['??', '??', '??', '??', '??', '??', '??', '??', '??', '??'];
  return emojis[seed % emojis.length];
}
```

```tsx
// apps/frontend/src/views/student/SOSCenter.tsx

import React, { useState, useEffect } from 'react';
import { useTTS } from '../../core/hooks/useTTS';

/**
 * SOS 情绪支持中心
 * 
 * 设计原则：
 * - 全屏覆盖，给予安全感
 * - 深呼吸动画 + 求助话术
 * - 简单明了的退出路径
 */
interface SOSCenterProps {
  onResolved: () => void;
  onBehaviorEvent: (event: { eventType: string; metadata?: object }) => void;
}

export function SOSCenter({ onResolved, onBehaviorEvent }: SOSCenterProps) {
  const { speak } = useTTS();
  const [phase, setPhase] = useState<'main' | 'breathing' | 'help_phrases'>('main');

  useEffect(() => {
    speak('没关系，我们先休息一下');
  }, []);

  // 深呼吸动画
  const BreathingExercise = () => {
    const [breathPhase, setBreathPhase] = useState<'inhale' | 'hold' | 'exhale'>('inhale');
    const [count, setCount] = useState(4);

    useEffect(() => {
      const cycle = () => {
        // 吸气4秒 → 屏住4秒 → 呼气4秒
        setBreathPhase('inhale');
        speak('吸气');
        setTimeout(() => {
          setBreathPhase('hold');
          speak('屏住');
          setTimeout(() => {
            setBreathPhase('exhale');
            speak('呼气');
          }, 4000);
        }, 4000);
      };

      cycle();
      const interval = setInterval(cycle, 12000);
      return () => clearInterval(interval);
    }, []);

    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div
          className={`
            rounded-full transition-all duration-[4000ms] ease-in-out
            ${breathPhase === 'inhale' ? 'w-80 h-80 bg-blue-200' : ''}
            ${breathPhase === 'hold' ? 'w-80 h-80 bg-blue-300' : ''}
            ${breathPhase === 'exhale' ? 'w-40 h-40 bg-blue-100' : ''}
          `}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="text-5xl font-bold text-blue-600">
            {breathPhase === 'inhale' && '吸气...'}
            {breathPhase === 'hold' && '屏住...'}
            {breathPhase === 'exhale' && '呼气...'}
          </span>
        </div>

        <button
          onClick={() => setPhase('main')}
          className="mt-12 px-12 py-6 bg-gray-100 rounded-2xl text-3xl text-gray-600"
          style={{ minHeight: '100px' }}
        >
          ← 返回
        </button>
      </div>
    );
  };

  // 求助话术按钮
  const HelpPhrases = () => {
    const phrases = [
      { emoji: '??', text: '老师，我需要去安静的地方休息一下' },
      { emoji: '?', text: '老师，这道题我不会做' },
      { emoji: '??', text: '老师，我想去洗手间' },
      { emoji: '??', text: '老师，我想喝水' },
    ];

    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <h2 className="text-4xl font-bold text-gray-700 mb-6">点击按钮，系统帮你说</h2>
        {phrases.map((phrase, index) => (
          <button
            key={index}
            onClick={() => {
              speak(phrase.text);
              onBehaviorEvent({ eventType: 'help_phrase_used', metadata: { phrase: phrase.text } });
            }}
            className="
              w-full max-w-2xl px-8 py-6 rounded-2xl
              bg-white shadow-md hover:shadow-lg
              border-2 border-gray-200 hover:border-blue-300
              flex items-center gap-4
              transition-all
            "
            style={{ minHeight: '100px' }}
          >
            <span className="text-5xl">{phrase.emoji}</span>
            <span className="text-2xl font-semibold text-gray-700">{phrase.text}</span>
          </button>
        ))}
        <button
          onClick={() => setPhase('main')}
          className="mt-6 px-12 py-6 bg-gray-100 rounded-2xl text-3xl text-gray-600"
          style={{ minHeight: '100px' }}
        >
          ← 返回
        </button>
      </div>
    );
  };

  // 主界面
  if (phase === 'breathing') return <BreathingExercise />;
  if (phase === 'help_phrases') return <HelpPhrases />;

  return (
    <div className="fixed inset-0 z-[9999] bg-gradient-to-b from-blue-100 to-green-100 flex flex-col items-center justify-center p-12">
      <h1 className="text-5xl font-bold text-gray-700 mb-16">
        没关系，我们可以休息一下 ??
      </h1>

      <div className="grid grid-cols-1 gap-8 w-full max-w-xl">
        <button
          onClick={() => setPhase('breathing')}
          className="px-8 py-10 bg-blue-100 hover:bg-blue-200 rounded-3xl text-3xl font-bold text-blue-700 transition-all shadow-lg"
          style={{ minHeight: '120px' }}
        >
          ?? 深呼吸放松
        </button>

        <button
          onClick={() => setPhase('help_phrases')}
          className="px-8 py-10 bg-purple-100 hover:bg-purple-200 rounded-3xl text-3xl font-bold text-purple-700 transition-all shadow-lg"
          style={{ minHeight: '120px' }}
        >
          ??? 我想告诉老师
        </button>

        <button
          onClick={() => {
            speak('好的，我们继续吧');
            onResolved();
          }}
          className="px-8 py-10 bg-green-100 hover:bg-green-200 rounded-3xl text-3xl font-bold text-green-700 transition-all shadow-lg"
          style={{ minHeight: '120px' }}
        >
          ? 我准备好了，继续
        </button>
      </div>
    </div>
  );
}
```

---

### 2.7 教师端核心视图

```tsx
// apps/frontend/src/views/teacher/TeacherDashboard.tsx

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';

/**
 * 教师主控台
 * 功能：查看全班学生今日训练概况、快速进入各功能
 */
export function TeacherDashboard() {
  const { data: todayStats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/api/reports/today-summary').then(r => r.data),
  });

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">教师管理台</h1>

      {/* 今日概览卡片 */}
      <div className="grid grid-cols-4 gap-6 mb-10">
        <StatCard label="今日训练人数" value={todayStats?.activeStudents ?? 0} icon="??" color="blue" />
        <StatCard label="完成训练次数" value={todayStats?.completedSessions ?? 0} icon="?" color="green" />
        <StatCard label="SOS触发次数" value={todayStats?.sosEvents ?? 0} icon="??" color="orange" />
        <StatCard label="技能达标数" value={todayStats?.masteryAchieved ?? 0} icon="?" color="purple" />
      </div>

      {/* 快捷功能入口 */}
      <div className="grid grid-cols-3 gap-6">
        <QuickAction title="学生管理" description="建档、编辑学生信息" path="/teacher/students" icon="??" />
        <QuickAction title="训练计划" description="为学生分配训练模块和目标" path="/teacher/plans" icon="??" />
        <QuickAction title="进展报告" description="查看能力雷达图和IEP数据" path="/teacher/reports" icon="??" />
        <QuickAction title="实操验收" description="记录学生线下操作表现" path="/teacher/generalization" icon="??" />
        <QuickAction title="行为分析" description="查看情绪/行为事件统计" path="/teacher/behaviors" icon="??" />
        <QuickAction title="系统设置" description="PIN修改、数据导出、模块管理" path="/teacher/settings" icon="??" />
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    orange: 'bg-orange-50 border-orange-200',
    purple: 'bg-purple-50 border-purple-200',
  };

  return (
    <div className={`p-6 rounded-2xl border-2 ${colorClasses[color]}`}>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{icon}</span>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-800">{value}</p>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ title, description, path, icon }: { title: string; description: string; path: string; icon: string }) {
  return (
    <a
      href={path}
      className="p-6 rounded-2xl bg-white border-2 border-gray-100 hover:border-blue-300 hover:shadow-lg transition-all flex items-start gap-4"
    >
      <span className="text-4xl">{icon}</span>
      <div>
        <h3 className="text-xl font-bold text-gray-800">{title}</h3>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
    </a>
  );
}
```

```tsx
// apps/frontend/src/views/teacher/ProgressReport.tsx

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';

/**
 * 学生能力进展报告
 * 
 * 功能：
 * 1. 能力雷达图
 * 2. 技能维度进展时间线
 * 3. 行为事件趋势
 * 4. 辅助递减进度
 * 5. IEP 建议生成
 */
export function ProgressReport() {
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'semester'>('month');

  const { data: report } = useQuery({
    queryKey: ['progress-report', selectedStudent, timeRange],
    queryFn: () => api.get(`/api/reports/progress/${selectedStudent}`, { params: { range: timeRange } }).then(r => r.data),
    enabled: !!selectedStudent,
  });

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">能力进展报告</h1>

      {/* 学生选择 + 时间范围 */}
      <div className="flex gap-4 mb-8">
        <StudentSelector onSelect={setSelectedStudent} />
        <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
      </div>

      {report && (
        <div className="grid grid-cols-2 gap-8">
          {/* 左列：能力雷达图 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-bold mb-4">能力画像</h2>
            <RadarChart data={report.skillLevels} />
          </div>

          {/* 右列：关键指标 */}
          <div className="space-y-6">
            {/* 辅助递减进度 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-bold mb-4">辅助递减进度</h2>
              {report.promptFadingProgress?.map((skill: any) => (
                <div key={skill.id} className="mb-3">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{skill.name}</span>
                    <span>{skill.currentStage}</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full mt-1">
                    <div
                      className="h-full bg-gradient-to-r from-blue-400 to-green-400 rounded-full transition-all"
                      style={{ width: `${skill.progressPercent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* 行为事件趋势 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-bold mb-4">行为事件趋势</h2>
              <div className="text-sm text-gray-600 space-y-2">
                <p>?? SOS频率: {report.behaviorTrends?.sosRate} (趋势: {report.behaviorTrends?.sosTrend})</p>
                <p>?? 暂停频率: {report.behaviorTrends?.pauseRate} (趋势: {report.behaviorTrends?.pauseTrend})</p>
                <p>?? 重复指令: {report.behaviorTrends?.repeatRate} (趋势: {report.behaviorTrends?.repeatTrend})</p>
              </div>
            </div>

            {/* IEP 建议 */}
            <div className="bg-yellow-50 rounded-2xl p-6 border-2 border-yellow-200">
              <h2 className="text-xl font-bold mb-4">?? IEP 建议目标</h2>
              <ul className="space-y-2">
                {report.iepSuggestions?.map((suggestion: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700">
                    <span className="text-yellow-500">?</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 导出按钮 */}
      {report && (
        <div className="mt-8 flex gap-4">
          <button className="px-6 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600">
            ?? 导出 PDF 报告
          </button>
          <button className="px-6 py-3 bg-green-500 text-white rounded-xl hover:bg-green-600">
            ?? 导出 Excel 数据
          </button>
        </div>
      )}
    </div>
  );
}
```

---

### 2.8 角色切换与路由隔离

```tsx
// apps/frontend/src/App.tsx

import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// 布局
import { StudentLayout } from './layouts/StudentLayout';
import { TeacherLayout } from './layouts/TeacherLayout';

// 学生端视图
import { StudentLogin } from './views/student/StudentLogin';
import { ModuleSelect } from './views/student/ModuleSelect';
import { TrainingSession } from './views/student/TrainingSession';

// 教师端视图
import { TeacherDashboard } from './views/teacher/TeacherDashboard';
import { StudentManagement } from './views/teacher/StudentManagement';
import { PlanAssignment } from './views/teacher/PlanAssignment';
import { ProgressReport } from './views/teacher/ProgressReport';

// PIN 输入组件
import { PINGate } from './components/PINGate';

// 状态
import { useAuthStore } from './core/state/auth-store';

const queryClient = new QueryClient();

type AppRole = 'student' | 'teacher' | null;

export default function App() {
  const { role, setRole } = useAuthStore();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {role === null && <RoleSelector onSelectRole={setRole} />}
        {role === 'student' && <StudentApp />}
        {role === 'teacher' && <TeacherApp onExit={() => setRole(null)} />}
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * 角色选择器
 * 学生：直接点击"我是学生"进入
 * 教师：需要输入4位PIN
 */
function RoleSelector({ onSelectRole }: { onSelectRole: (role: AppRole) => void }) {
  const [showPINInput, setShowPINInput] = useState(false);

  if (showPINInput) {
    return <PINGate onSuccess={() => onSelectRole('teacher')} onCancel={() => setShowPINInput(false)} />;
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-b from-sky-100 to-emerald-100 gap-12">
      <h1 className="text-5xl font-bold text-gray-700">
        职业能力训练系统
      </h1>
      <div className="flex gap-12">
        <button
          onClick={() => onSelectRole('student')}
          className="w-72 h-72 rounded-3xl bg-white shadow-xl flex flex-col items-center justify-center gap-4 hover:shadow-2xl hover:scale-105 transition-all border-4 border-transparent hover:border-blue-300"
        >
          <span className="text-8xl">??</span>
          <span className="text-3xl font-bold text-gray-700">我是学生</span>
        </button>

        <button
          onClick={() => setShowPINInput(true)}
          className="w-72 h-72 rounded-3xl bg-white shadow-xl flex flex-col items-center justify-center gap-4 hover:shadow-2xl hover:scale-105 transition-all border-4 border-transparent hover:border-green-300"
        >
          <span className="text-8xl">?????</span>
          <span className="text-3xl font-bold text-gray-700">我是老师</span>
        </button>
      </div>
    </div>
  );
}

function StudentApp() {
  return (
    <StudentLayout>
      <Routes>
        <Route path="/" element={<StudentLogin onSelect={() => {}} />} />
        <Route path="/module-select" element={<ModuleSelect />} />
        <Route path="/training" element={<TrainingSession />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </StudentLayout>
  );
}

function TeacherApp({ onExit }: { onExit: () => void }) {
  return (
    <TeacherLayout onExit={onExit}>
      <Routes>
        <Route path="/teacher" element={<TeacherDashboard />} />
        <Route path="/teacher/students" element={<StudentManagement />} />
        <Route path="/teacher/plans" element={<PlanAssignment />} />
        <Route path="/teacher/reports" element={<ProgressReport />} />
        <Route path="*" element={<Navigate to="/teacher" />} />
      </Routes>
    </TeacherLayout>
  );
}
```

```tsx
// apps/frontend/src/components/PINGate.tsx

import React, { useState } from 'react';

interface PINGateProps {
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * PIN 输入门禁
 * 
 * 设计原则：
 * - 大按钮数字键盘（教师在触控屏上也方便操作）
 * - 4位PIN，错误3次锁定30秒
 */
export function PINGate({ onSuccess, onCancel }: PINGateProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);

  const handleDigit = (digit: string) => {
    if (locked) return;
    const newPin = pin + digit;
    setPin(newPin);

    if (newPin.length === 4) {
      verifyPIN(newPin);
    }
  };

  const verifyPIN = async (inputPin: string) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: inputPin }),
      });

      if (response.ok) {
        onSuccess();
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setPin('');
        setError('PIN不正确');

        if (newAttempts >= 3) {
          setLocked(true);
          setTimeout(() => {
            setLocked(false);
            setAttempts(0);
            setError('');
          }, 30000);
        }
      }
    } catch {
      setError('系统连接失败');
      setPin('');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
      <h2 className="text-3xl font-bold text-gray-700 mb-8">请输入教师PIN码</h2>

      {/* PIN 显示 */}
      <div className="flex gap-4 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`w-16 h-16 rounded-xl border-2 flex items-center justify-center text-3xl font-bold
              ${pin.length > i ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}
            `}
          >
            {pin.length > i ? '●' : ''}
          </div>
        ))}
      </div>

      {/* 错误提示 */}
      {error && <p className="text-red-500 text-lg mb-4">{error}</p>}
      {locked && <p className="text-orange-500 text-lg mb-4">输入次数过多，请30秒后重试</p>}

      {/* 数字键盘 */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {['1','2','3','4','5','6','7','8','9','','0','?'].map(digit => (
          <button
            key={digit}
            onClick={() => {
              if (digit === '?') setPin(p => p.slice(0, -1));
              else if (digit) handleDigit(digit);
            }}
            disabled={locked || digit === ''}
            className={`
              w-20 h-20 rounded-2xl text-3xl font-bold
              ${digit === '' ? 'invisible' : ''}
              ${locked ? 'bg-gray-100 text-gray-300' : 'bg-white shadow-md hover:shadow-lg hover:bg-blue-50 active:bg-blue-100'}
              transition-all
            `}
          >
            {digit}
          </button>
        ))}
      </div>

      <button
        onClick={onCancel}
        className="px-8 py-4 text-xl text-gray-500 hover:text-gray-700"
      >
        ← 返回
      </button>
    </div>
  );
}
```

---

### 2.9 无障碍样式系统

```css
/* apps/frontend/src/styles/accessibility.css */

/**
 * 特教无障碍设计系统
 * 
 * 规则：
 * 1. 所有可交互元素 min-height ≥ 100px
 * 2. 关键字号 ≥ 32px
 * 3. 禁止纯红色作为错误指示
 * 4. 高对比度可选
 * 5. 动画可关闭
 */

:root {
  /* 核心尺寸变量 */
  --min-touch-target: 100px;
  --min-font-size: 32px;
  --heading-font-size: 48px;




  /* 色彩系统：柔和色调，禁止纯红 */
  --color-success: #4CAF50;          /* 成功：绿色 */
  --color-success-bg: #E8F5E9;
  --color-encourage: #FF9800;        /* 鼓励/重试：暖橙（非红色） */
  --color-encourage-bg: #FFF3E0;
  --color-info: #2196F3;             /* 信息/引导：蓝色 */
  --color-info-bg: #E3F2FD;
  --color-neutral: #9E9E9E;          /* 中性 */
  --color-neutral-bg: #F5F5F5;
  --color-calm: #7E57C2;             /* 平静/SOS：紫色 */
  --color-calm-bg: #EDE7F6;

  /* 禁止使用的颜色（开发红线） */
  /* ? #FF0000, #F44336, #D32F2F — 纯红色系全部禁止 */

  /* 间距系统 */
  --spacing-xs: 8px;
  --spacing-sm: 16px;
  --spacing-md: 24px;
  --spacing-lg: 32px;
  --spacing-xl: 48px;

  /* 圆角系统 */
  --radius-sm: 12px;
  --radius-md: 20px;
  --radius-lg: 28px;
  --radius-full: 9999px;

  /* 动画控制 */
  --animation-speed: 1;              /* 1=正常, 0=关闭动画 */
  --transition-base: 200ms ease;
}

/* 高对比度模式（教师可在设置中为特定学生开启） */
[data-theme="high-contrast"] {
  --color-success: #1B5E20;
  --color-info: #0D47A1;
  --min-font-size: 36px;
}

/* 减少动画模式（感官敏感学生） */
[data-reduce-motion="true"] {
  --animation-speed: 0;
}
[data-reduce-motion="true"] * {
  animation: none !important;
  transition: none !important;
}

/* ===== 全局强制规则 ===== */

/* 所有按钮最小尺寸 */
button, [role="button"], .touchable {
  min-height: var(--min-touch-target);
  min-width: var(--min-touch-target);
  font-size: var(--min-font-size);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation; /* 避免双击缩放 */
}

/* 拖拽元素禁止系统默认行为 */
.draggable {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

/* 错误状态样式 —— 温和提示，非红色 */
.feedback-incorrect {
  border-color: var(--color-encourage) !important;
  background-color: var(--color-encourage-bg) !important;
  animation: gentle-shake 0.4s ease;
}

@keyframes gentle-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-8px); }
  75% { transform: translateX(8px); }
}

/* 成功状态 */
.feedback-correct {
  border-color: var(--color-success) !important;
  background-color: var(--color-success-bg) !important;
  animation: gentle-pop 0.3s ease;
}

@keyframes gentle-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

/* 高亮引导（辅助提示用） */
.highlight-guide {
  animation: pulse-highlight calc(1.5s * var(--animation-speed)) infinite;
  box-shadow: 0 0 0 4px var(--color-info);
}

@keyframes pulse-highlight {
  0%, 100% { box-shadow: 0 0 0 4px rgba(33, 150, 243, 0.4); }
  50% { box-shadow: 0 0 0 12px rgba(33, 150, 243, 0.1); }
}

/* ===== 焦点指示器（键盘导航时可见） ===== */
:focus-visible {
  outline: 4px solid var(--color-info);
  outline-offset: 4px;
  border-radius: var(--radius-sm);
}

/* 隐藏触控操作时的焦点框 */
:focus:not(:focus-visible) {
  outline: none;
}
```

---

## 三、API 路由详细设计

```python
# backend/app/routers/sessions.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from app.database import get_db
from app.models.training_session import TrainingSession
from app.schemas.session import SessionCreate, SessionUpdate, SessionResponse
from app.services.adaptive_engine import AdaptiveEngine
from app.services.prompt_fading import PromptFadingEngine

router = APIRouter()

@router.post("/", response_model=SessionResponse)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)):
    """创建新的训练会话"""
    session = TrainingSession(
        student_id=payload.student_id,
        module_id=payload.module_id,
        plan_id=payload.plan_id,
        session_mood_start=payload.mood_start,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.patch("/{session_id}", response_model=SessionResponse)
def end_session(session_id: str, payload: SessionUpdate, db: Session = Depends(get_db)):
    """结束训练会话"""
    session = db.query(TrainingSession).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
  
    session.ended_at = payload.ended_at or datetime.utcnow()
    session.end_reason = payload.end_reason
    session.total_tasks = payload.total_tasks
    session.correct_tasks = payload.correct_tasks
    session.session_mood_end = payload.mood_end
  
    db.commit()
    db.refresh(session)
  
    # 会话结束时触发自适应评估
    if session.plan_id:
        adaptive = AdaptiveEngine()
        plan = db.query(TrainingPlan).filter_by(id=session.plan_id).first()
        if plan:
            adaptive.evaluate_and_adjust(db, session.student_id, plan.skill_dimension_id, plan.id)
            PromptFadingEngine().evaluate_fading(db, session.student_id, plan.id)
  
    return session


@router.get("/student/{student_id}/recent")
def get_recent_sessions(student_id: str, limit: int = 10, db: Session = Depends(get_db)):
    """获取学生近期训练会话"""
    sessions = (
        db.query(TrainingSession)
        .filter_by(student_id=student_id)
        .order_by(TrainingSession.started_at.desc())
        .limit(limit)
        .all()
    )
    return sessions
```

```python
# backend/app/routers/reports.py

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional

from app.database import get_db
from app.services.report_generator import ReportGenerator

router = APIRouter()

@router.get("/today-summary")
def get_today_summary(db: Session = Depends(get_db)):
    """教师仪表盘：今日训练概览"""
    generator = ReportGenerator(db)
    return generator.today_summary()


@router.get("/progress/{student_id}")
def get_progress_report(
    student_id: str,
    range: str = Query("month", regex="^(week|month|semester)$"),
    db: Session = Depends(get_db)
):
    """学生能力进展报告"""
    generator = ReportGenerator(db)
  
    # 计算时间范围
    now = datetime.utcnow()
    range_map = {
        "week": timedelta(days=7),
        "month": timedelta(days=30),
        "semester": timedelta(days=120),
    }
    start_date = now - range_map[range]
  
    return generator.progress_report(student_id, start_date, now)


@router.get("/iep-suggestions/{student_id}")
def get_iep_suggestions(student_id: str, db: Session = Depends(get_db)):
    """基于训练数据自动生成 IEP 目标建议"""
    generator = ReportGenerator(db)
    return generator.generate_iep_suggestions(student_id)


@router.get("/export/{student_id}")
def export_report(
    student_id: str,
    format: str = Query("json", regex="^(json|csv)$"),
    db: Session = Depends(get_db)
):
    """导出学生完整数据（供教师下载）"""
    generator = ReportGenerator(db)
    return generator.export_student_data(student_id, format)
```

```python
# backend/app/services/report_generator.py

from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from datetime import datetime, timedelta
from typing import List, Dict, Optional

from app.models.training_session import TrainingSession
from app.models.task_result import TaskResult
from app.models.behavior_event import BehaviorEvent
from app.models.training_plan import TrainingPlan
from app.models.skill_dimension import SkillDimension
from app.models.student import Student


class ReportGenerator:
    """报告生成服务"""

    def __init__(self, db: Session):
        self.db = db

    def today_summary(self) -> dict:
        """今日概览（教师仪表盘）"""
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0)

        active_students = (
            self.db.query(func.count(func.distinct(TrainingSession.student_id)))
            .filter(TrainingSession.started_at >= today_start)
            .scalar()
        )

        completed_sessions = (
            self.db.query(func.count(TrainingSession.id))
            .filter(
                TrainingSession.started_at >= today_start,
                TrainingSession.end_reason == 'completed'
            )
            .scalar()
        )

        sos_events = (
            self.db.query(func.count(BehaviorEvent.id))
            .filter(
                BehaviorEvent.timestamp >= today_start,
                BehaviorEvent.event_type == 'sos_click'
            )
            .scalar()
        )

        mastery_achieved = (
            self.db.query(func.count(TrainingPlan.id))
            .filter(
                TrainingPlan.status == 'mastered',
                TrainingPlan.updated_at >= today_start
            )
            .scalar()
        )

        return {
            "activeStudents": active_students,
            "completedSessions": completed_sessions,
            "sosEvents": sos_events,
            "masteryAchieved": mastery_achieved,
            "date": today_start.isoformat(),
        }

    def progress_report(self, student_id: str, start_date: datetime, end_date: datetime) -> dict:
        """学生能力进展报告"""
      
        # 1. 获取各技能维度当前等级
        plans = (
            self.db.query(TrainingPlan)
            .filter_by(student_id=student_id)
            .filter(TrainingPlan.status.in_(['active', 'mastered']))
            .all()
        )

        skill_levels = {}
        prompt_fading_progress = []
      
        for plan in plans:
            dim = self.db.query(SkillDimension).filter_by(id=plan.skill_dimension_id).first()
            if dim:
                skill_levels[dim.name] = {
                    "currentLevel": plan.current_level,
                    "maxLevel": dim.max_level,
                    "status": plan.status,
                }
              
                # 辅助递减进度
                fading_stages = ['full_support', 'partial_support', 'minimal_support', 'independent']
                current_index = fading_stages.index(plan.prompt_fading_stage) if plan.prompt_fading_stage in fading_stages else 0
                prompt_fading_progress.append({
                    "id": plan.skill_dimension_id,
                    "name": dim.name,
                    "currentStage": plan.prompt_fading_stage,
                    "progressPercent": int((current_index / (len(fading_stages) - 1)) * 100),
                })

        # 2. 行为事件趋势
        behavior_trends = self._calculate_behavior_trends(student_id, start_date, end_date)

        # 3. 正确率趋势
        accuracy_trend = self._calculate_accuracy_trend(student_id, start_date, end_date)

        # 4. IEP 建议
        iep_suggestions = self._generate_suggestions(student_id, plans)

        return {
            "studentId": student_id,
            "period": {"start": start_date.isoformat(), "end": end_date.isoformat()},
            "skillLevels": skill_levels,
            "promptFadingProgress": prompt_fading_progress,
            "behaviorTrends": behavior_trends,
            "accuracyTrend": accuracy_trend,
            "iepSuggestions": iep_suggestions,
        }

    def _calculate_behavior_trends(self, student_id: str, start: datetime, end: datetime) -> dict:
        """计算行为事件趋势"""
        # 按周聚合 SOS 频率
        events = (
            self.db.query(BehaviorEvent)
            .filter(
                BehaviorEvent.student_id == student_id,
                BehaviorEvent.timestamp.between(start, end)
            )
            .all()
        )

        sos_count = sum(1 for e in events if e.event_type == 'sos_click')
        pause_count = sum(1 for e in events if e.event_type == 'pause')
        repeat_count = sum(1 for e in events if e.event_type in ('repeat_video', 'repeat_instruction'))

        # 计算会话总数来算比率
        session_count = (
            self.db.query(func.count(TrainingSession.id))
            .filter(
                TrainingSession.student_id == student_id,
                TrainingSession.started_at.between(start, end)
            )
            .scalar()
        ) or 1

        # 简单趋势：对比前半段和后半段
        mid_point = start + (end - start) / 2
        first_half_sos = sum(1 for e in events if e.event_type == 'sos_click' and e.timestamp < mid_point)
        second_half_sos = sum(1 for e in events if e.event_type == 'sos_click' and e.timestamp >= mid_point)
      
        sos_trend = "↓ 下降" if second_half_sos < first_half_sos else ("↑ 上升" if second_half_sos > first_half_sos else "→ 稳定")

        return {
            "sosRate": f"{sos_count / session_count:.1f}次/会话",
            "sosTrend": sos_trend,
            "pauseRate": f"{pause_count / session_count:.1f}次/会话",
            "pauseTrend": "→ 稳定",
            "repeatRate": f"{repeat_count / session_count:.1f}次/会话",
            "repeatTrend": "→ 稳定",
        }

    def _calculate_accuracy_trend(self, student_id: str, start: datetime, end: datetime) -> list:
        """按周计算正确率趋势"""
        results = (
            self.db.query(TaskResult)
            .filter(
                TaskResult.student_id == student_id,
                TaskResult.completed_at.between(start, end)
            )
            .order_by(TaskResult.completed_at)
            .all()
        )

        # 按周分桶
        weekly_data = []
        current_week_start = start
        while current_week_start < end:
            week_end = current_week_start + timedelta(days=7)
            week_results = [r for r in results if current_week_start <= r.completed_at < week_end]
          
            if week_results:
                accuracy = sum(1 for r in week_results if r.is_correct) / len(week_results)
                weekly_data.append({
                    "week": current_week_start.strftime("%m/%d"),
                    "accuracy": round(accuracy, 2),
                    "taskCount": len(week_results),
                })
          
            current_week_start = week_end

        return weekly_data

    def _generate_suggestions(self, student_id: str, plans: list) -> List[str]:
        """基于数据自动生成 IEP 目标建议"""
        suggestions = []

        for plan in plans:
            dim = self.db.query(SkillDimension).filter_by(id=plan.skill_dimension_id).first()
            if not dim:
                continue

            if plan.status == 'mastered':
                suggestions.append(f"? 「{dim.name}」已掌握，建议进入泛化实践阶段")
            elif plan.current_level < 2 and plan.prompt_fading_stage == 'full_support':
                suggestions.append(f"?? 「{dim.name}」进展缓慢(L{plan.current_level})，建议增加训练频次或调整教学策略")
            elif plan.prompt_fading_stage in ('minimal_support', 'independent'):
                suggestions.append(f"?? 「{dim.name}」即将达标(L{plan.current_level}，{plan.prompt_fading_stage})，建议开展泛化验证")
            else:
                target = min(plan.current_level + 1, dim.max_level)
                suggestions.append(f"?? 「{dim.name}」下一目标：L{target}，当前辅助阶段{plan.prompt_fading_stage}")

        return suggestions

    def export_student_data(self, student_id: str, format: str) -> dict:
        """导出学生完整训练数据"""
        student = self.db.query(Student).filter_by(id=student_id).first()
        sessions = self.db.query(TrainingSession).filter_by(student_id=student_id).all()
        results = self.db.query(TaskResult).filter_by(student_id=student_id).all()
        events = self.db.query(BehaviorEvent).filter_by(student_id=student_id).all()

        export_data = {
            "student": {
                "name": student.name,
                "age": student.age,
                "diagnosis": student.diagnosis,
            },
            "summary": {
                "totalSessions": len(sessions),
                "totalTasks": len(results),
                "overallAccuracy": sum(1 for r in results if r.is_correct) / max(len(results), 1),
                "totalBehaviorEvents": len(events),
            },
            "sessions": [
                {
                    "id": s.id,
                    "date": s.started_at.isoformat() if s.started_at else None,
                    "module": s.module_id,
                    "tasks": s.total_tasks,
                    "correct": s.correct_tasks,
                    "endReason": s.end_reason,
                }
                for s in sessions
            ],
        }

        return export_data
```

---

## 四、模块注册种子数据

```python
# backend/app/seed/seed_modules.py

from app.database import SessionLocal
from app.models.vocational_module import VocationalModule
from app.models.skill_dimension import SkillDimension
import json

def seed_initial_modules():
    """应用启动时注册所有职业模块和技能维度"""
    db = SessionLocal()
  
    try:
        # 检查是否已经播种过
        existing = db.query(VocationalModule).first()
        if existing:
            return
      
        # ===== 超市理货模块（第一期·激活） =====
        shelf_module = VocationalModule(
            module_id="shelf_stocking",
            display_name="超市理货",
            version="1.0.0",
            is_active=True,
        )
        db.add(shelf_module)

        shelf_dimensions = [
            {
                "id": "shelf_stocking.product_sorting",
                "name": "商品分类",
                "description": "能将商品按品类正确归入对应区域",
                "max_level": 3,
                "underlying_abilities": ["visual_matching", "category_recognition"],
                "level_descriptions": [
                    "L0: 无法区分两类明显不同的商品",
                    "L1: 能区分2类差异明显的商品",
                    "L2: 能区分3-4类商品并正确归位",
                    "L3: 能处理相似品类的细分归位",
                ],
            },
            {
                "id": "shelf_stocking.shelf_arrangement",
                "name": "排面整理",
                "description": "能按规则将商品整齐排列在货架上",
                "max_level": 3,
                "underlying_abilities": ["spatial_awareness", "sequential_execution"],
                "level_descriptions": [
                    "L0: 无法理解对齐的概念",
                    "L1: 能将物品沿标线排成一排",
                    "L2: 能按标签朝向一致排列",
                    "L3: 能独立整理一组乱序的货架",
                ],
            },
            {
                "id": "shelf_stocking.damage_detection",
                "name": "临损检测",
                "description": "能识别破损、变形、过期等异常商品",
                "max_level": 3,
                "underlying_abilities": ["anomaly_detection", "visual_comparison"],
                "level_descriptions": [
                    "L0: 无法识别明显破损的物品",
                    "L1: 能识别显著物理损坏",
                    "L2: 能识别轻微损坏和日期过期",
                    "L3: 能综合判断并决定处置方式",
                ],
            },
            {
                "id": "shelf_stocking.restocking_procedure",
                "name": "补货流程",
                "description": "能按标准流程完成商品补货操作",
                "max_level": 3,
                "underlying_abilities": ["sequential_execution", "working_memory"],
                "level_descriptions": [
                    "L0: 无法按顺序完成2步操作",
                    "L1: 能在全程提示下完成3步补货流程",
                    "L2: 能在部分提示下完成4步补货流程",
                    "L3: 能独立完成完整补货SOP",
                ],
            },
        ]

        for dim in shelf_dimensions:
            db.add(SkillDimension(
                id=dim["id"],
                module_id="shelf_stocking",
                name=dim["name"],
                description=dim["description"],
                max_level=dim["max_level"],
                underlying_abilities=json.dumps(dim["underlying_abilities"]),
                level_descriptions=json.dumps(dim["level_descriptions"]),
            ))

        # ===== 包装分拣模块（第二期·未激活） =====
        packaging_module = VocationalModule(
            module_id="packaging_sorting",
            display_name="包装与分拣",
            version="0.1.0",
            is_active=False,
        )
        db.add(packaging_module)

        # ===== AI数据标注模块（第三期·未激活） =====
        annotation_module = VocationalModule(
            module_id="ai_data_annotation",
            display_name="AI数据标注",
            version="0.1.0",
            is_active=False,
        )
        db.add(annotation_module)

        # ===== 手工制作模块（第三期·未激活） =====
        handicraft_module = VocationalModule(
            module_id="handicraft_making",
            display_name="手工工艺制作",
            version="0.1.0",
            is_active=False,
        )
        db.add(handicraft_module)

        db.commit()
        print("? 模块种子数据初始化完成")
      
    except Exception as e:
        db.rollback()
        print(f"? 种子数据初始化失败: {e}")
    finally:
        db.close()
```

---

## 五、Electron 打包与部署配置

```javascript
// apps/electron-shell/electron-builder.config.js

/**
 * Electron Builder 打包配置
 * 目标：生成单个安装程序，内含前端+后端+数据库
 */
module.exports = {
  appId: "com.specialedu.vocational-training",
  productName: "特殊青少年职业能力训练系统",
  copyright: "Copyright ? 2024",

  directories: {
    output: "dist-installer",
    buildResources: "resources",
  },

  files: [
    "dist/**/*",           // Electron 主进程编译产物
    "!node_modules",
  ],

  // 将前端打包产物纳入
  extraResources: [
    {
      from: "../frontend/dist",
      to: "frontend",
      filter: ["**/*"],
    },
    // 将 Python 后端打包产物纳入
    {
      from: "../../backend/dist",
      to: "backend",
      filter: ["**/*"],
    },
    // 内置素材资源
    {
      from: "../../assets",
      to: "assets",
      filter: ["**/*"],
    },
  ],

  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    icon: "resources/icon.ico",
  },

  nsis: {
    oneClick: true,
    perMachine: true,               // 安装到系统目录
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "职业能力训练系统",
    // 安装后自动启动
    runAfterFinish: true,
  },

  // 开机自启注册
  // 通过 Electron auto-launch 库在应用内实现，而非安装器
};
```

```yaml
# pnpm-workspace.yaml

packages:
  - 'apps/*'
  - 'shared'
```

```json
// package.json (顶层 monorepo)
{
  "name": "vocational-training-system",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "concurrently \"pnpm --filter frontend dev\" \"pnpm --filter electron-shell dev\" \"cd backend && uvicorn app.main:app --reload --port 8000\"",
    "build:frontend": "pnpm --filter frontend build",
    "build:backend": "cd backend && pyinstaller --onedir --name backend app/main.py",
    "build:electron": "pnpm --filter electron-shell build",
    "build:all": "pnpm build:frontend && pnpm build:backend && pnpm build:electron",
    "package": "pnpm build:all && pnpm --filter electron-shell package",
    "db:reset": "cd backend && rm -f data.db && python -c \"from app.seed.seed_modules import seed_initial_modules; seed_initial_modules()\"",
    "test:backend": "cd backend && pytest",
    "test:frontend": "pnpm --filter frontend test"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```

---

## 六、开发环境搭建指南

```bash
# ===== 1. 前置条件 =====
# Node.js >= 18
# Python >= 3.10
# pnpm >= 8

# ===== 2. 克隆项目后初始化 =====

# 安装前端依赖
pnpm install

# 安装 Python 后端依赖
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# 或使用 poetry: poetry install

# ===== 3. 初始化数据库 =====
cd backend
python -c "
from app.database import engine, Base
from app.models import *  # 导入所有模型
Base.metadata.create_all(bind=engine)
from app.seed.seed_modules import seed_initial_modules
seed_initial_modules()
print('Database initialized!')
"

# ===== 4. 启动开发环境 =====
# 回到项目根目录
cd ..
pnpm dev

# 这会同时启动：
# - Vite (前端) → http://localhost:5173
# - FastAPI (后端) → http://localhost:8000
# - Electron (桌面壳) → 自动打开窗口加载 localhost:5173

# ===== 5. 访问 API 文档 =====
# http://localhost:8000/docs  (Swagger UI)
```

```txt
# backend/requirements.txt

fastapi==0.109.0
uvicorn[standard]==0.27.0
sqlalchemy==2.0.25
pydantic==2.5.3
pydantic-settings==2.1.0
alembic==1.13.1
python-multipart==0.0.6
httpx==0.26.0       # 测试用
pytest==7.4.4       # 测试用
pyinstaller==6.3.0  # 打包用
```

---

## 七、第一期开发任务拆解 (Sprint Plan)

```
┌──────────────────────────────────────────────────────────────────┐
│ Sprint 1 (Week 1-2): 基础架构搭建                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 后端任务：                                                        │
│ □ 初始化 FastAPI 项目结构                                         │
│ □ 实现全部 8 张表的 ORM Model                                     │
│ □ 实现 Students CRUD API + 测试                                   │
│ □ 实现 Operators CRUD + PIN验证 API                               │
│ □ 实现 Modules 查询 API                                          │
│ □ 实现 Sessions 创建/结束 API                                     │
│ □ 实现 TaskResults 写入 API                                      │
│ □ 实现 BehaviorEvents 写入 API                                   │
│ □ 种子数据脚本（4模块注册 + 超市理货技能维度）                       │
│ □ /health 探针                                                   │
│                                                                  │
│ 前端任务：                                                        │
│ □ 初始化 React + Vite + Tailwind 项目                             │
│ □ 实现角色选择页（学生/教师入口）                                   │
│ □ 实现 PIN 输入组件                                               │
│ □ 实现学生选择页（大头像网格）                                     │
│ □ 实现模块选择页                                                  │
│ □ 搭建 Zustand 状态管理                                          │
│ □ 搭建 API Client 封装                                           │
│ □ 实现无障碍 CSS 变量系统                                         │
│                                                                  │
│ Electron 任务：                                                   │
│ □ 初始化 Electron 项目 + preload 脚本                             │
│ □ 实现 Kiosk 模式（全屏+禁用快捷键）                               │
│ □ 实现后端子进程管理（启动/健康检查/关闭）                           │
│ □ 实现 PIN 解锁退出机制                                           │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Sprint 2 (Week 3-4): 核心交互引擎 + 训练流程                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 交互引擎组件：                                                    │
│ □ usePointerDrag Hook 开发 + 触控屏测试                           │
│ □ DragToZone 组件（含碰撞检测、弹回动画、反馈）                    │
│ □ DragToSort 组件（拖拽排序）                                     │
│ □ TapSelect 组件（点选识别）                                      │
│ □ SequentialSteps 引导器（多步骤流程）                             │
│ □ FeedbackOverlay（成功/重试反馈动画）                             │
│ □ RewardAnimation（星星/里程碑动画）                               │
│ □ VisualTimer（可视化倒计时/进度条）                               │
│                                                                  │
│ 训练流程：                                                        │
│ □ 训练状态机实现（全部状态转换）                                   │
│ □ SessionManager 实现                                            │
│ □ 四步法流程容器（看→学→练→做）                                    │
│ □ useTTS Hook（Web Speech API 中文语音）                          │
│ □ SOS 情绪支持中心完整实现                                        │
│ □ 情绪自评（开始/结束时表情选择）                                  │
│ □ 休息提醒机制（每N题强制休息）                                    │
│                                                                  │
│ 后端业务逻辑：                                                    │
│ □ AdaptiveEngine（自适应难度）实现 + 单元测试                     │
│ □ PromptFadingEngine（辅助递减）实现 + 单元测试                   │
│ □ MasteryEvaluator（掌握判定）实现 + 单元测试                     │
│ □ Generalizations API（泛化验收记录）                             │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Sprint 3 (Week 5): 超市理货模块内容 + 教师端                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 内容制作：                                                        │
│ □ 商品图片素材准备（30+张，含正常/临损）                           │
│ □ 分类训练：3级难度 × 5套配置                                     │
│ □ 排面整理：3级难度 × 5套配置                                     │
│ □ 临损检测：3级难度 × 5套配置                                     │
│ □ 补货流程：3级难度 × 3套配置                                     │
│ □ 基线评估探测任务配置                                            │
│ □ 教学视频/分步图片制作                                           │
│ □ TTS 文案编写（温和语气指导语）                                  │
│                                                                  │
│ 教师端：                                                          │
│ □ 教师仪表盘（今日概览）                                          │
│ □ 学生管理页（建档/编辑/查看）                                    │
│ □ 训练计划分配页                                                  │
│ □ 泛化验收页（独立性5级评分 + 备注）                               │
│ □ 基础进展报告页（能力等级 + 辅助阶段）                            │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Sprint 4 (Week 6): 集成测试 + 用户测试 + 打包                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ □ 完整流程端到端测试                                              │
│ □ Windows 触控屏实机测试（借用学校设备）                           │
│ □ 邀请 2-3 位特教老师操作测试                                     │
│ □ 邀请 1-2 位学生参与可用性测试                                   │
│ □ 收集反馈 + Bug修复                                             │
│ □ UX 微调（按钮大小、语速、动画节奏）                              │
│ □ Electron 打包为 Windows 安装程序                                □
│ □ 编写教师操作手册                                                │
│ □ 部署到目标一体机验证                                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 八、关键技术风险与应对

| # | 风险 | 影响 | 应对策略 |
|---|:---|:---|:---|
| 1 | Windows 触控屏 Pointer Events 兼容性 | 拖拽交互失效 | Week 1 即借设备做 PoC 验证；准备 Touch Events 降级方案 |
| 2 | Web Speech API 中文语音质量 | TTS 发音不清/不自然 | 预备离线 TTS 方案（如 edge-tts 本地引擎）；允许教师自录语音 |
| 3 | SQLite 并发写入冲突 | 多个前端组件同时写 | 后端加写入队列；实际场景单用户不太可能并发 |
| 4 | PyInstaller 打包后体积过大 | 安装包 >500MB | 精简依赖；使用 --exclude-module 剔除不必要模块 |
| 5 | 学生对新系统的接受度 | 拒绝使用/情绪激动 | 渐进引入（先看教师演示→陪同使用→独立使用）；首次使用仅开放基线探测 |
| 6 | 特教老师技术能力有限 | 无法独立维护系统 | 编写图文操作手册；提供一键重置工具；尽量零配置 |

---

## 九、V2 MediaPipe 摄像头集成预设计

```python
# backend/app/hardware/camera_mediapipe.py
# V2 实现预留 —— 当前文件为设计文档，第一期不编码

"""
V2 摄像头功能规划：

1. 手工制作模块：
   - MediaPipe Hands → 识别学生手部动作是否正确
   - 对比标准动作序列与学生实际动作

2. 超市理货/包装分拣 泛化验证：
   - MediaPipe Object Detection → 识别实物货架上的商品摆放
   - 拍照对比：学生摆完后拍照，系统辅助判断整齐度

3. 通用功能：
   - 实操过程录像（供教师事后回看）
   - 成品照片存档（关联到 generalization_records.photo_path）

技术路径：
- Python 端：opencv-python + mediapipe
- 通过 Electron IPC 调用
- 前端通过 preload API 获取分析结果

接口预留（已在 hardware/base.py 中定义）：
- CameraInterface.is_available()
- CameraInterface.capture_frame()
- MediaPipeAnalyzer.analyze_hand_gesture()
- MediaPipeAnalyzer.analyze_object_position()
"""
```

---

## 十、文档结尾：核心设计原则清单

> 开发团队在任何设计决策时，请对照以下原则：

1. **结构化优先**：特殊学生需要高度可预测的交互流程，永远不让学生处于"不知道该做什么"的状态。

2. **零负面反馈**：没有红色、没有警告音、没有弹窗。错误只是"再试一次"。

3. **辅助可递减**：系统的终极目标是学生能独立完成，而非永远依赖系统提示。

4. **数据即价值**：每一次点击、每一次犹豫、每一次求助都是有教育价值的数据，都要记录。

5. **教师是主角**：系统辅助教学，不替代教师判断。教师可以随时覆盖系统的自动决策。

6. **引擎共享，内容分离**：交互组件是引擎，职业内容是配置。增加新职业方向应该是"填表"而非"重写"。

7. **离线第一**：永远假设没有网络。所有功能必须在断网状态下完整可用。

---

**TDD 文档到此完整结束。**
