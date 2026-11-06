/** Guest profile placeholder (accounts are not available yet). */
export function SidebarFooter() {
  return (
    <footer className="side-foot">
      <div className="profile" title="Guest: not signed in. Profiles are not available yet" role="img" aria-label="Guest, not signed in">
        <span className="avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7z" />
          </svg>
        </span>
        <span className="profile-text">
          <strong>Guest</strong>
          <span className="muted small">Not signed in</span>
        </span>
      </div>
    </footer>
  )
}
