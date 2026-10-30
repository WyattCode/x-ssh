/** True when a deferred/global tooltip should force-dismiss (window inactive). */
export function shouldDismissTooltip(visibilityState: string, blurred: boolean): boolean {
  return blurred || visibilityState === 'hidden'
}
