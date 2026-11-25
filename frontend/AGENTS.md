# Frontend agent instructions

Work from `frontend/`. Use the Node version in `.nvmrc` and npm with the committed lockfile. Before handing off a change, run `npm run lint` and `npm run build`. The build includes the TypeScript check.

## React conventions

- Keep components pure. Call Hooks at the top level of function components or custom Hooks. Keep Strict Mode enabled. [Rules of React](https://react.dev/reference/rules)
- Keep state close to the components that own it. Compute display values from props and state during render. Handle user actions in event handlers and use Effects for synchronization with external systems. [Choosing state structure](https://react.dev/learn/choosing-the-state-structure) · [When to use an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- Split components and functions by responsibility. For these two views, keep feature-specific UI and data access together. Extract shared code when both views need it.
- Give named standalone functions a short JSDoc description. A constant used in only one file can stay there. Put shared feature constants in the owning feature’s `consts/` folder and constants shared across features in `src/consts/`.
- Use native links for navigation, buttons for actions, and visible labels for form controls. Loading, empty, and failed requests need distinct UI states. [W3C forms guidance](https://www.w3.org/WAI/tutorials/forms/labels/)

## CompetitorPulse API

- Use relative `/api` URLs. Nest owns polling, change detection, AI summaries, and persistence. Treat listing text as data and render it through normal JSX interpolation.
- Preserve the backend’s timeline order. Key entries by `pollId`. For “Load older polls”, pass `X-Next-Cursor` back as the `cursor` query parameter. Reset pagination when switching competitors.
- Present `outcomeKind` and `summaryStatus` separately. A listing request timeout and a summary timeout describe different events. Keep an unobserved listing field unknown. [Timeline contract](../docs/architecture/competitor-timeline.md)

## Agent references

React’s official rules guide component correctness. For a performance review, Vercel Engineering publishes the `vercel-react-best-practices` agent skill. Its client-side rules about request waterfalls and bundle size apply to this Vite app. [Rules of React](https://react.dev/reference/rules) · [Vercel React Best Practices skill](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices)

For a UI review, Vercel’s `web-design-guidelines` skill covers keyboard interaction, focus, forms, and accessibility. [Vercel agent skills directory](https://vercel.com/docs/agent-resources/skills)
