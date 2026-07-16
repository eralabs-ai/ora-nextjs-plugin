import { RegisterTools } from './register-tools';

export default function Home() {
  return (
    <main>
      <h1>WebMCP imperative fixture</h1>
      <p>Registers an in-page tool via navigator.modelContext.registerTool().</p>
      <RegisterTools />
    </main>
  );
}
