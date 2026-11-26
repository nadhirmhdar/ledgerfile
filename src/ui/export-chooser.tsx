import { Button } from "./button";
import { Callout } from "./feedback";
import { Field, Select } from "./form";
import { Section } from "./layout";
import { count } from "./text";

/**
 * Take the engagement file away: the whole of it, or one index section, with the size it will be (from stored sizes, so it is "about"). A plain GET form:
 * the route streams the zip and logs the download, so nothing is prefetched, and it re-reads the role and the cap itself.
 */
export function ExportChooser({
  action,
  whole,
  sections,
  refusal,
}: {
  action: string;
  whole: { files: number; size: string };
  sections: { code: string; title: string; files: number; size: string }[];
  /** Why the whole file cannot be taken in one piece, or null. */
  refusal: string | null;
}) {
  return (
    <Section title="Download the file" id="download" description={`The whole file: about ${count(whole.files, "file")}, ${whole.size}. Every download holds a README and this engagement's audit log.`}>
      {refusal && (
        <Callout variant="warning" className="mb-3">
          {refusal}
        </Callout>
      )}
      <form method="get" action={action} className="flex flex-wrap items-end gap-3">
        <Field label="What to download" className="max-w-full basis-80">
          <Select name="section" defaultValue={refusal && sections[0] ? sections[0].code : ""}>
            <option value="" disabled={!!refusal}>
              The whole file ({count(whole.files, "file")}, {whole.size})
            </option>
            {sections.map((s) => (
              <option key={s.code} value={s.code}>
                Section {s.code} {s.title} ({count(s.files, "file")}, {s.size})
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary" type="submit">
          Download
        </Button>
      </form>
    </Section>
  );
}
