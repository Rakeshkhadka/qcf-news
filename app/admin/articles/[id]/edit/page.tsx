"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import ArticleForm from "../../ArticleForm";

export default function EditArticlePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return (
      <div>
        <div className="error-box">Invalid article id.</div>
        <Link href="/admin/articles" className="btn btn-ghost">← Back to Articles</Link>
      </div>
    );
  }

  return <ArticleForm mode="edit" articleId={id} />;
}
