# 🎬 影院放映设备台账系统

管理放映机、音响、银幕、控制台四类放映设备的台账，支持按影厅/类型/状态/关键词查询，
管理员可增删改与 Excel 批量导入，普通员工仅可查询。

## 功能

- **账号登录 / JWT 鉴权**，两种角色：
  - 管理员：设备新增、编辑、删除、批量导入、模板与失败行下载
  - 普通员工：仅登录查询（含筛选、搜索、查看），无任何写操作入口
- **设备台账**：影厅、设备类型、品牌、序列号（唯一）、责任人、状态、备注；
  状态分 在用 / 维修中 / 停用 / 备用，列表带状态色签与更新时间
- **组合筛选**：影厅、设备类型、状态 + 关键词（品牌/序列号/责任人/影厅）
- **Excel 批量导入**（.xlsx）：
  - 一键下载标准导入模板（含表头与示例行）
  - 逐行校验：必填项、设备类型/状态枚举、序列号库内唯一与文件内去重
  - 导入结果弹窗：成功/失败条数 + 失败明细（Excel 行号 + 原因）
  - **失败行下载**：导出含「失败原因」列的 xlsx，修正后可重新导入（失败记录保留 1 小时）
  - 合法行先行入库，失败行不影响其他数据

## 默认账号

| 角色 | 账号 | 密码 |
|---|---|---|
| 管理员 | admin | admin123 |
| 普通员工 | staff | staff123 |

> ⚠️ 默认账号密码仅用于本地开发，部署到生产环境前请登录数据库修改密码哈希，
> 或在 `server/seed.js` 中改为强密码后重新初始化。

## 启动

```bash
npm install
npm run seed    # 初始化数据库与默认账号/示例数据（首次）
npm start       # http://localhost:3000
```

生产环境请通过环境变量指定 JWT 签名密钥（未设置时系统会生成随机密钥，重启后所有登录状态失效）：

```bash
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") npm start
```

技术栈：Node.js + Express + better-sqlite3（零外部数据库依赖，数据存 data/ledger.db）+
JWT + Multer + SheetJS(xlsx)，前端为原生 HTML/CSS/JS 单页。

## 主要 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | /api/login | 公开 | 登录获取 token |
| GET | /api/equipment | 登录 | 设备列表（hall/category/status/keyword） |
| POST/PUT/DELETE | /api/equipment[/:id] | 管理员 | 新增/修改/删除 |
| GET | /api/import/template | 登录 | 下载导入模板 |
| POST | /api/import | 管理员 | 上传 xlsx 批量导入 |
| GET | /api/import/:batchId/errors | 管理员 | 下载失败行 |
