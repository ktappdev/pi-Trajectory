interface IconProps {
  readonly name: 'search' | 'fold' | 'unfold' | 'chevron' | 'close' | 'clock' | 'filter'
  readonly size?: number
}

export function Icon({ name, size = 16 }: IconProps): React.JSX.Element {
  const paths: Record<IconProps['name'], React.JSX.Element> = {
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    fold: <><path d="M4 7h16M4 12h16M4 17h16" /><path d="m10 4 2 3 2-3M10 20l2-3 2 3" /></>,
    unfold: <><path d="M4 7h16M4 12h16M4 17h16" /><path d="m12 4-2 3h4l-2-3M12 20l2-3h4l-2 3" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>,
    filter: <path d="M4 5h16l-6 7v5l-4 2v-7z" />,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
