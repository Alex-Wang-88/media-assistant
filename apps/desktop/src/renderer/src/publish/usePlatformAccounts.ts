import { useMutation } from "@tanstack/react-query";
import type { BilibiliAccount, XAccount, ZhihuAccount } from "@yoom/desktop-contracts";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import type { MemoryPublishDraft } from "./publish-draft-model";

export function usePlatformAccounts({
  open,
  setDrafts,
  updateSelectedDraft,
  setNotice,
  setError,
}: {
  open: boolean;
  setDrafts: Dispatch<SetStateAction<MemoryPublishDraft[]>>;
  updateSelectedDraft(patch: Partial<MemoryPublishDraft>): void;
  setNotice(message: string | null): void;
  setError(message: string | null): void;
}) {
  const [bilibiliAccounts, setBilibiliAccounts] = useState<BilibiliAccount[]>([]);
  const [zhihuAccounts, setZhihuAccounts] = useState<ZhihuAccount[]>([]);
  const [xAccounts, setXAccounts] = useState<XAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const refreshPlatformAccounts = useCallback(
    async (showLoading = false) => {
      if (showLoading) setAccountsLoading(true);
      try {
        const [accounts, loadedZhihuAccounts, loadedXAccounts] = await Promise.all([
          window.desktop.publish.listBilibiliAccounts(),
          window.desktop.publish.listZhihuAccounts?.() ?? Promise.resolve([]),
          window.desktop.publish.listXAccounts(),
        ]);
        setBilibiliAccounts(accounts);
        setZhihuAccounts(loadedZhihuAccounts);
        setXAccounts(loadedXAccounts);
        const defaultBilibiliAccountId = accounts[0]?.id ?? null;
        const defaultZhihuAccountId = loadedZhihuAccounts[0]?.id ?? null;
        const defaultXAccountId = loadedXAccounts[0]?.id ?? null;
        setDrafts((current) =>
          current.map((draft) => {
            if (draft.platform === "bilibili" && !draft.bilibiliAccountId) {
              return { ...draft, bilibiliAccountId: defaultBilibiliAccountId };
            }
            if (draft.platform === "zhihu" && !draft.zhihuAccountId) {
              return { ...draft, zhihuAccountId: defaultZhihuAccountId };
            }
            if (draft.platform === "x" && !draft.xAccountId) {
              return { ...draft, xAccountId: defaultXAccountId };
            }
            return draft;
          }),
        );
      } catch (reason: unknown) {
        if (showLoading) setError(readableError(reason));
      } finally {
        if (showLoading) setAccountsLoading(false);
      }
    },
    [setDrafts, setError],
  );

  useEffect(() => {
    if (!open) return;
    void refreshPlatformAccounts(true);
    const handleWindowFocus = () => {
      void refreshPlatformAccounts();
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [open, refreshPlatformAccounts]);

  const createBilibiliAccount = useMutation({
    mutationFn: () => window.desktop.publish.createBilibiliAccount(),
    onSuccess: (account) => {
      setBilibiliAccounts((current) =>
        current.some((candidate) => candidate.id === account.id)
          ? current.map((candidate) => (candidate.id === account.id ? account : candidate))
          : [...current, account],
      );
      updateSelectedDraft({ bilibiliAccountId: account.id, automationResult: null });
      setNotice(`已识别并保存 B 站账号“${account.name}”`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const deleteBilibiliAccount = useMutation({
    mutationFn: (account: BilibiliAccount) =>
      window.desktop.publish.deleteBilibiliAccount(account.id),
    onSuccess: (accounts, deletedAccount) => {
      const replacementAccountId = accounts[0]?.id ?? null;
      setBilibiliAccounts(accounts);
      setDrafts((current) =>
        current.map((draft) =>
          draft.bilibiliAccountId === deletedAccount.id
            ? { ...draft, bilibiliAccountId: replacementAccountId, automationResult: null }
            : draft,
        ),
      );
      setNotice(`已永久删除 B 站账号“${deletedAccount.name}”的本地登录数据`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const createZhihuAccount = useMutation({
    mutationFn: () => {
      const createAccount = window.desktop.publish.createZhihuAccount;
      if (!createAccount) throw new Error("当前应用版本未加载知乎账号功能");
      return createAccount();
    },
    onSuccess: (account) => {
      setZhihuAccounts((current) =>
        current.some((candidate) => candidate.id === account.id)
          ? current.map((candidate) => (candidate.id === account.id ? account : candidate))
          : [...current, account],
      );
      updateSelectedDraft({ zhihuAccountId: account.id, automationResult: null });
      setNotice(`已识别并保存知乎账号“${account.name}”`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const deleteZhihuAccount = useMutation({
    mutationFn: (account: ZhihuAccount) => {
      const deleteAccount = window.desktop.publish.deleteZhihuAccount;
      if (!deleteAccount) throw new Error("当前应用版本未加载知乎账号功能");
      return deleteAccount(account.id);
    },
    onSuccess: (accounts, deletedAccount) => {
      const replacementAccountId = accounts[0]?.id ?? null;
      setZhihuAccounts(accounts);
      setDrafts((current) =>
        current.map((draft) =>
          draft.zhihuAccountId === deletedAccount.id
            ? { ...draft, zhihuAccountId: replacementAccountId, automationResult: null }
            : draft,
        ),
      );
      setNotice(`已永久删除知乎账号“${deletedAccount.name}”的本地登录数据`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const createXAccount = useMutation({
    mutationFn: () => window.desktop.publish.createXAccount(),
    onSuccess: (account) => {
      setXAccounts((current) =>
        current.some((candidate) => candidate.id === account.id)
          ? current.map((candidate) => (candidate.id === account.id ? account : candidate))
          : [...current, account],
      );
      updateSelectedDraft({ xAccountId: account.id, automationResult: null });
      setNotice(`已识别并保存 X 账号“${account.name}”`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const deleteXAccount = useMutation({
    mutationFn: (account: XAccount) => window.desktop.publish.deleteXAccount(account.id),
    onSuccess: (accounts, deletedAccount) => {
      const replacementAccountId = accounts[0]?.id ?? null;
      setXAccounts(accounts);
      setDrafts((current) =>
        current.map((draft) =>
          draft.xAccountId === deletedAccount.id
            ? { ...draft, xAccountId: replacementAccountId, automationResult: null }
            : draft,
        ),
      );
      setNotice(`已永久删除 X 账号“${deletedAccount.name}”的本地登录数据`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  return {
    bilibiliAccounts,
    zhihuAccounts,
    xAccounts,
    accountsLoading,
    refreshPlatformAccounts,
    createBilibiliAccount,
    deleteBilibiliAccount,
    createZhihuAccount,
    deleteZhihuAccount,
    createXAccount,
    deleteXAccount,
  };
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
