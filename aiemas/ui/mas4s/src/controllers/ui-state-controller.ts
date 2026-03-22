export type DialogKind = "none" | "invite";
export type NavItem = "workspace" | "usage" | "agents" | "skills" | "cron" | "users" | "settings";

export interface UIStateCallback {
  setNav(nav: NavItem): void;
  setDialog(kind: DialogKind): void;
}

/**
 * 导航与弹窗状态控制器。
 * 封装 nav-change / invite-open / dialog-close 事件处理，
 * 通过回调通知宿主更新 @state。
 */
export class UIStateController {
  constructor(private readonly cb: UIStateCallback) {}

  onNavChange = (e: CustomEvent<{ nav: NavItem }>) => {
    this.cb.setNav(e.detail.nav);
  };

  onInviteOpen = () => {
    this.cb.setDialog("invite");
  };

  onDialogClose = () => {
    this.cb.setDialog("none");
  };
}
