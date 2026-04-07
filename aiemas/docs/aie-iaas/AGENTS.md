# IaaS Agent 开发规范 (AIE-IaaS)

## 接口调用规范 (API Guidelines)

### 1. 分页处理 (Pagination)

- **现象**：xstack 云平台的所有 `GET` 查询类接口均采用分页机制。
- **默认行为**：若不指定分页参数，后端通常默认仅返回前 **25** 条数据。
- **要求**：Agent 工具在执行查询时，必须显式处理分页逻辑（建议 `pageSize` 设为 100），并通过循环（`pageIndex++`）获取所有页面的数据，确保统计和查询结果的完整性。

## 模型生命周期状态 (Model Lifecycle)

### 1. 仓库模型状态 (EnumRepositoryModelStatus)

在进行自动化部署时，必须根据模型状态决定后续动作：

- `NotDownloaded`: 初始状态，需调用 `download_model`。
- `Downloading`: 异步下载中，需轮询等待。
- `Downloaded`: 下载完成，此时方可调用 `publish_model`。
- `Published`: 发布完成，此时方可调用 `create_service` 创建推理服务。
- `DownloadFailed`: 下载失败，需终止流程并报错。
