/**
 * A dashboard pane: a customizable grid of monitoring widgets that poll the
 * server on a timer (via `poll_widget_command`, a one-shot exec sharing the SSH
 * worker). Unlike the rest of the app this pane is NOT a Hyprland split tree —
 * it's a simple responsive grid of widget cards.
 *
 * Step 2 renders only the empty state; the widget grid, picker, and polling are
 * added in later steps.
 */
export default function DashboardPane({ id }: { id: string }) {
  return (
    <div className="h-full w-full overflow-auto bg-ink-900 p-4" data-pane-id={id}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-4xl opacity-40 select-none">📊</div>
        <p className="text-sm text-slate-400">아직 위젯이 없어요.</p>
        <p className="text-2xs text-slate-500">
          위젯을 추가해 서버 상태를 한눈에 확인해보세요.
        </p>
      </div>
    </div>
  );
}
