# language: zh-CN
# capability: subject-literacy.deleteById
# files: SubjectLiteracyApiServiceImpl.java
@subject-literacy @methods

功能: 按主键ID软删学科素养

  约束:
    - 软删除而非物理删除(deleted=1)
    - 已删除的再次调用返回成功(幂等)

  场景: 正常删除
    假设 id=1001 存在且未删除
    当 调用 deleteById(1001)
    那么 响应 code 应为 200
    而且 数据库中 deleted 应为 1
