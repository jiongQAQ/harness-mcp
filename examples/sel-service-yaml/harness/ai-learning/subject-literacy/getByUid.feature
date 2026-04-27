# language: zh-CN
# capability: subject-literacy.getByUid
# files: SubjectLiteracyApiServiceImpl.java
@subject-literacy @methods

功能: 按知识图谱节点UID查询学科素养

  ## 规格(给 AI 读 — 不可执行)

  约束:
    - uid 是知识图谱节点 id,不是 examId
    - 一个 uid 下可挂多条素养,返回必须是列表
    - 软删除记录不返回

  ## 示例(可执行)

  场景: uid 下挂多条 — 全部返回
    假设 仓储 selectListByUid 入参为 "node-001" 时返回 2 条记录:
      | id   | topic       |
      | 1001 | 勾股定理    |
      | 1002 | 毕达哥拉斯  |
    当 调用 getByUid 入参 "node-001"
    那么 响应 code 应为 200
    而且 data 应包含 2 条记录

  场景: uid 下无记录 — 返回空列表
    假设 仓储 selectListByUid 入参为 "node-x" 时返回空列表
    当 调用 getByUid 入参 "node-x"
    那么 响应 code 应为 200
    而且 data 应为空列表
