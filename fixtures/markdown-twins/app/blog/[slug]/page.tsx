// A dynamic route: its concrete URLs aren't statically knowable, so the twin pass counts it and
// recommends (add a markdown source, or prerender representative routes) rather than guessing.
export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main>
      <h1>Post: {slug}</h1>
    </main>
  );
}
