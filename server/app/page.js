export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '80px auto', padding: '0 20px', lineHeight: 1.6 }}>
      <h1>⬡ LiveArch — hosted</h1>
      <p>Permanent, shareable architecture diagrams. Publish from the CLI:</p>
      <pre style={{ background: '#f4f4f4', padding: 16, borderRadius: 8, overflowX: 'auto' }}>
{`# one-shot
livearch push <handle>/<repo> --server ${'<this-url>'}

# then open
${'<this-url>'}/u/<handle>/<repo>`}
      </pre>
      <p style={{ color: '#666' }}>
        Phase 1 MVP — stores the last snapshot and serves it at a permanent URL.
        Live sync and accounts are Phase 2/3 (see <code>docs/BACKEND-DESIGN.md</code>).
      </p>
    </main>
  );
}
