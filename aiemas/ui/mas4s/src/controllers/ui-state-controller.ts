export type DialogKind = "none" | "invite";
export type NavItem = "workspace" | "usage" | "agents" | "skills" | "cron" | "users" | "settings";

export interface UIStateCallback {
  setNav(nav: NavItem): void;
  setDialog(kind: DialogKind): void;
  onWorkspaceEnter?(): void;
}

/**
 * 导航与弹窗状态控制器。
 * 封装 nav-change / invite-open / dialog-close 事件处理，
 * 通过回调通知宿主更新 @state。
 */
export class UIStateController {
  private _prevNav: NavItem | null = null;

  constructor(private readonly cb: UIStateCallback) {}

  onNavChange = (e: CustomEvent<{ nav: NavItem }>) => {
    const nav = e.detail.nav;
    // 从其他模块切换到工作台时触发刷新
    if (nav === "workspace" && this._prevNav !== "workspace") {
      this.cb.onWorkspaceEnter?.();
    }
    this._prevNav = nav;
    this.cb.setNav(nav);
  };

  onInviteOpen = () => {
    this.cb.setDialog("invite");
  };

  onDialogClose = () => {
    this.cb.setDialog("none");
  };
}
