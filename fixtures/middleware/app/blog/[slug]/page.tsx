// A dynamic route: whether /blog/<anything> exists is only knowable at request time, so the
// manifest records the /blog prefix and the middleware never answers a miss under it with the
// wayfinding body — this page (any slug renders) is exactly the real content that would otherwise
// be mislabeled "not found".
export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main>
      <h1>Blog: {slug}</h1>
      <p>This dynamic page renders for every slug the fixture is asked for.</p>
    </main>
  );
}
