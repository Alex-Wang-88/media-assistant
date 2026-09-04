export type PublishAccount = { id: string; name: string };

export function PlatformAccountSelector<TAccount extends PublishAccount>({
  platformLabel,
  accounts,
  selectedAccountId,
  newAccountValue,
  busy,
  creating,
  deleting,
  keepAtLeastOne,
  onSelect,
  onCreate,
  onDelete,
}: {
  platformLabel: string;
  accounts: TAccount[];
  selectedAccountId: string | null;
  newAccountValue: string;
  busy: boolean;
  creating: boolean;
  deleting: boolean;
  keepAtLeastOne: boolean;
  onSelect(accountId: string | null): void;
  onCreate(): void;
  onDelete(account: TAccount): void;
}) {
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  return (
    <div className="publish-account-setting">
      <label>
        发布账号
        <span className="publish-account-control">
          <select
            value={selectedAccountId ?? ""}
            disabled={busy || creating || deleting}
            onChange={(event) => {
              if (event.target.value === newAccountValue) onCreate();
              else onSelect(event.target.value || null);
            }}
          >
            {accounts.length === 0 ? <option value="">暂无已记录账号</option> : null}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
            <option value={newAccountValue}>＋ 使用新账号</option>
          </select>
          <button
            type="button"
            disabled={!selectedAccount || deleting || (keepAtLeastOne && accounts.length <= 1)}
            onClick={() => {
              if (
                selectedAccount &&
                window.confirm(
                  `确定永久删除${platformLabel}账号“${selectedAccount.name}”吗？该账号的本地 Cookie 和 Session 将无法恢复。`,
                )
              ) {
                onDelete(selectedAccount);
              }
            }}
          >
            {deleting ? "正在删除…" : "删除当前账号"}
          </button>
        </span>
        <small>已有账号复用各自登录状态；使用新账号会打开独立的登录或授权流程</small>
      </label>
      {creating ? (
        <small className="publish-account-login-status">
          正在等待新账号登录；只有识别到用户名后才会保存
        </small>
      ) : null}
    </div>
  );
}
