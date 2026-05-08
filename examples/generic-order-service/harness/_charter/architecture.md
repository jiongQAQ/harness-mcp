# 架构约定

- API 层只负责协议适配和参数转换。
- Application Service 负责编排业务用例。
- Domain Service 承载跨实体业务规则。
- Repository 只负责持久化访问,不写业务判断。

