# language: zh-CN
# capability: subject-literacy.deleteById
# files: SubjectLiteracyApiServiceImpl.java
@subject-literacy @methods

功能: 按主键ID软删学科素养

  业务来源:
    - 用户提供: 学科素养内容需要支持按主键删除
    - 代码推断: SubjectLiteracyApiServiceImpl#deleteById

  意图:
    - 让调用方按主键移除一条学科素养内容,同时保留数据可追溯性。

  边界:
    - 本能力只承诺删除语义,不承诺物理清理历史数据。

  核心承诺:
    - 删除必须是软删除而非物理删除。
    - 已删除数据再次删除应保持幂等成功。

  风险:
    - AI 可能把软删除改成物理删除。
    - AI 可能让重复删除抛错,破坏幂等调用。

  待确认:
    - 无

  场景: 正常删除
    假设 id=1001 存在且未删除
    当 调用 deleteById(1001)
    那么 响应 code 应为 200
    而且 数据库中 deleted 应为 1
