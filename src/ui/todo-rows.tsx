import { ArrowRightIcon } from "./icons";
import { ListRow, ListRows } from "./layout";

/** The list of things still open before the file can be locked: plain words, who it is for, and an arrow to where it is dealt with. */
export function ToDoRows({ items }: { items: { text: string; href: string; owner: "reviewer" | "partner" | null }[] }) {
  return (
    <ListRows>
      {items.map((t) => (
        <ListRow key={t.text} title={t.text} subtitle={t.owner ? `For ${t.owner === "partner" ? "a partner" : "a reviewer"}` : undefined} href={t.href} meta={<ArrowRightIcon />} />
      ))}
    </ListRows>
  );
}
