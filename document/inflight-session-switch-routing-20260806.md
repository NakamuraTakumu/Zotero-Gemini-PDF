---
title: "応答待機中のセッション切替ルーティング"
responsibility: "応答待機中に既存セッションへ切り替える際、送信元セッションへの保存と表示先の分離を定義し、変更範囲と検証条件を記録する。"
summary: "送信時のセッションへ応答を保存し、切替後の表示中セッションには応答UIを追加しないことで、待機中の既存セッション切替を許可した。"
created: "2026-08-06 09:20 UTC"
updated: "2026-08-06 09:20 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "7e0c55b358cc6a299d7c7230e5cd55f5bae60e62"
model: "gpt-5.6-terra"
reasoning_effort: "medium"
session: "019fd64c-9855-70d1-a8c3-4c85c7994e52"
handling: "document-workflow"
workflow_stage: "completed"
stale: false
---

# 応答待機中のセッション切替ルーティング

## Background

モデル応答を待つ間、セッション選択、New、およびDeleteを同じリクエスト中ロックとして停止していた。

送信時のセッションと表示中のセッションを区別しないまま選択だけを許可すると、応答が切替先へ追加される危険がある。

**送信元セッション**：送信開始時に取得した、ユーザー入力とモデル応答を保存するセッション。

**表示中セッション**：ChatPaneが現在描画しているセッション。

## At a Glance

既存セッションの選択は応答待機中も許可する。

保存処理は送信元セッションへ一度だけ行う。

表示中セッションが送信元と異なる間は応答のUI更新を行わず、送信元へ戻ったときは保存済み履歴を再描画する。

New、Delete、親item切替、provider/model、入力欄のロックは変更しない。

## Body

- [ルーティング契約](#ルーティング契約)
- [変更範囲](#変更範囲)
- [検証](#検証)

### ルーティング契約

送信開始時にactive sessionを送信元セッションとして取得する。

ユーザー入力、アシスタント応答、保存処理、および応答エラーは送信元セッションに結び付ける。

応答の途中と完了後のUI更新は、送信元セッションがなお表示中であるときに限る。

この条件が偽なら保存済みの応答を別セッションの画面へ追加しない。

同じセッションを表示したままなら、従来どおり進行中メッセージと完了メッセージを更新する。

### 変更範囲

セッションselectorはリクエスト中の無効化とイベント遮断の対象から外す。

NewとDeleteはリクエスト中に無効のままとする。

親item切替は、既存のin-flight送信完了待機を維持する。

グローバル削除イベントとの競合は、この変更の対象外とする。

### 検証

送信中に表示先を変えた場合、送信元セッションの保存が一度ずつ行われ、切替先の応答UI更新がないことを直接テストする。

送信元を表示したままの場合、応答UI更新が一度行われることを直接テストする。

セッションselectorはリクエスト中も操作でき、NewとDeleteは操作できないことを直接テストする。

TypeScript検査、整形検査、全テスト、およびbuildで実装を検証する。

### Referenced File Hashes

- `src/modules/reader/chatPane.ts`: `sha256:bc4bbc50b0c3d403824d00e3c9ce0acee0168d90f0261d3818fbcb0eeab4f706`
- `src/modules/reader/sendMessageUseCase.ts`: `sha256:f0349f410e2a12a506083881cc21378140d3fc612bee774e35218033f8b10f85`
- `test/sendMessageUseCase.test.ts`: `sha256:c5579c127321f19da2897f7927c48aa048a0223d2942b08078a71e226cee59ef`
