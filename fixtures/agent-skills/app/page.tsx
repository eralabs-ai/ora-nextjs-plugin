export default function Home() {
  return (
    <main>
      <h1>Agent skills fixture</h1>
      <p>
        Ships two skills under <code>skills/</code> that <code>publishSkills: true</code> publishes
        to <code>/.well-known/agent-skills/</code>, plus a third under <code>.claude/skills/</code>{' '}
        that stays private since auto-discovery never reaches into <code>.claude</code>.
      </p>
    </main>
  );
}
