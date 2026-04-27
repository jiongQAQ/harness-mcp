# language: zh-CN
功能: 通用编码约定

  场景: 响应体
    那么 所有 REST 接口返回 RestResponse<T>(code/message/data)

  场景: 软删除
    那么 软删字段统一为 deleted (0/1)
    而且 查询接口默认过滤 deleted=1
