# language: zh-CN
# capability: subject-literacy.getByUid
# files: SubjectLiteracyApiServiceImpl.java
@subject-literacy @methods

功能: 按知识图谱节点UID查询学科素养

  业务来源:
    - 用户提供: 学科素养按知识图谱节点展示的业务需求
    - 代码推断: SubjectLiteracyApiServiceImpl#getByUid

  意图:
    - 让调用方按知识图谱节点 uid 获取该节点下挂载的学科素养内容。

  边界:
    - 本能力只定义按 uid 查询的业务语义，不定义前端展示和编辑逻辑。

  核心承诺:
    - uid 是知识图谱节点 id,不是 examId。
    - 一个 uid 下可挂多条素养,返回必须是列表。
    - 软删除记录不返回。

  风险:
    - AI 可能把 uid 误当成 examId。
    - AI 可能把无记录返回 null,破坏调用方列表语义。

  待确认:
    - 无

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
