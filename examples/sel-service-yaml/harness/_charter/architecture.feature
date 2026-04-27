# language: zh-CN
功能: 项目分层约定

  Java 包按如下分层,不得反向依赖。

  场景: 标准分层
    那么 包结构如下:
      | 层                              | 说明              |
      | com.sel.*.api.service.impl.*   | 对外接口实现       |
      | com.sel.*.application.service  | 应用服务(用例编排) |
      | com.sel.*.domain               | 领域模型 + 仓储    |
      | com.sel.*.infrastructure       | 基础设施           |
