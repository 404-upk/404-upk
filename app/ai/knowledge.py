from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import KnowledgeArticle
from .text import normalize, stems


@dataclass
class Article:
    id: int
    question: str
    answer: str
    category: str | None
    keywords: list[str]
    source: str

    def as_source(self) -> dict:
        return {"id": self.id, "title": self.question, "source": self.source}


def load_articles(db: Session) -> list[Article]:
    rows = db.scalars(select(KnowledgeArticle).where(KnowledgeArticle.is_active)).all()
    return [
        Article(
            id=r.id,
            question=r.question,
            answer=r.answer,
            category=r.category.code if r.category else None,
            keywords=[k.strip() for k in r.keywords.split(",") if k.strip()],
            source=r.source,
        )
        for r in rows
    ]


def score(article: Article, text: str) -> float:
    norm = normalize(text)
    text_stems = stems(text)
    if not text_stems:
        return 0.0

    best_phrase = 0.0
    for phrase in article.keywords:
        phrase_stems = stems(phrase)
        if not phrase_stems:
            continue
        if normalize(phrase) in norm:
            best_phrase = max(best_phrase, 1.0)
        else:
            hit = len(phrase_stems & text_stems) / len(phrase_stems)
            if hit == 1.0:
                best_phrase = max(best_phrase, 0.85)
            elif hit >= 0.5 and len(phrase_stems) >= 2:
                best_phrase = max(best_phrase, 0.45 * hit)

    question_stems = stems(article.question)
    overlap = len(question_stems & text_stems) / max(len(text_stems), 1)
    return round(max(best_phrase, min(overlap, 0.8)), 3)


def search(articles: list[Article], text: str) -> tuple[Article | None, float]:
    best, best_score = None, 0.0
    for article in articles:
        s = score(article, text)
        if s > best_score:
            best, best_score = article, s
    return best, best_score
