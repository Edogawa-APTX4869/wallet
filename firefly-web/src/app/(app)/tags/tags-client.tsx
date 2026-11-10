"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckSquare, ChevronRight, Pencil, Plus, Square, Trash2, X } from "lucide-react";
import { api } from "@/lib/firefly/api";
import type { Resource, Tag } from "@/lib/firefly/types";
import { ResourceIconBadge, useResourceMeta, useUpdateResourceMeta } from "@/components/resource-icon";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Skeleton } from "@/components/ui";
import { useToast } from "@/components/providers";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

interface TagTreeGroup {
  parent: string;
  parentResource: Resource<Tag> | null;
  subtags: Array<{ sub: string; full: string; resource: Resource<Tag> }>;
}

const SEPARATORS = /\s*(?::|\/|>|›)\s*/;

function parseTagName(raw: string): { parent: string; sub: string } {
  const trimmed = raw.trim();
  const parts = trimmed.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { parent: trimmed, sub: "" };
  const [parent, ...rest] = parts;
  return { parent, sub: rest.join(": ") };
}

function formatTagName(parent: string, sub?: string): string {
  const p = parent.trim();
  const s = (sub ?? "").trim();
  if (!p) return s;
  if (!s) return p;
  return `${p}: ${s}`;
}

function buildTagTree(tags: Array<Resource<Tag>> = []): TagTreeGroup[] {
  const map = new Map<string, TagTreeGroup>();
  for (const r of tags) {
    const { parent, sub } = parseTagName(r.attributes.tag);
    if (!parent) continue;
    let group = map.get(parent);
    if (!group) {
      group = { parent, parentResource: null, subtags: [] };
      map.set(parent, group);
    }
    if (!sub) group.parentResource = r;
    else group.subtags.push({ sub, full: r.attributes.tag, resource: r });
  }
  return [...map.values()].sort((a, b) => a.parent.localeCompare(b.parent));
}

export function TagsClient() {
  const qc = useQueryClient();
  const toast = useToast();
  const meta = useResourceMeta();
  const updateMeta = useUpdateResourceMeta();

  const tagsQ = useQuery({
    queryKey: ["tags-list"],
    queryFn: api.tags,
  });

  const [newParent, setNewParent] = useState("");
  const [newSub, setNewSub] = useState("");
  const [newIsTodo, setNewIsTodo] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEscapeDismiss(editId !== null, () => setEditId(null), "tags-edit");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tags-list"] });

  const createMut = useMutation({
    mutationFn: async () => {
      const fullName = formatTagName(newParent, newSub);
      if (!fullName) throw new Error("Enter a tag name.");
      const res = await api.createTag(fullName);
      if (newIsTodo && res?.data?.id) {
        await updateMeta.mutateAsync({
          entity_type: "tag",
          entity_id: String(res.data.id),
          is_todo: true,
        });
      }
      return res;
    },
    onSuccess: () => {
      toast("Tag created");
      setNewParent("");
      setNewSub("");
      setNewIsTodo(false);
      invalidate();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, tag }: { id: string; tag: string }) => api.updateTag(id, tag.trim()),
    onSuccess: () => {
      toast("Tag updated");
      setEditId(null);
      invalidate();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => {
      toast("Tag deleted", "info");
      invalidate();
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const items = tagsQ.data ?? [];
  const tree = buildTagTree(items);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tags & Sub-tags"
        subtitle="Hierarchical tags (Tag → Sub-tag), custom icons, and Pico-style To-Do checklist tags"
      />

      <div className="rounded-xl border border-border bg-surface p-3.5 sm:p-4 shadow-2xs">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="grid gap-3 sm:grid-cols-4"
        >
          <Field label="Main Tag">
            {(id) => (
              <>
                <Input
                  id={id}
                  list={`${id}-parents`}
                  value={newParent}
                  onChange={(e) => setNewParent(e.target.value)}
                  placeholder="e.g. Trip, Reimbursable, Project"
                  required
                />
                <datalist id={`${id}-parents`}>
                  {tree.map((g) => (
                    <option key={g.parent} value={g.parent} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Sub-tag (optional)">
            {(id) => (
              <Input
                id={id}
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="e.g. Flights, Hotel, Client-A"
              />
            )}
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsTodo}
                onChange={(e) => setNewIsTodo(e.target.checked)}
                className="size-4 accent-primary"
              />
              Mark as To-Do / Action tag
            </label>
          </div>
          <div className="flex items-end">
            <Button type="submit" loading={createMut.isPending} className="w-full">
              <Plus className="size-4" aria-hidden /> Add Tag
            </Button>
          </div>
        </form>
      </div>

      <ErrorBox error={tagsQ.error} />

      {tagsQ.isLoading ? (
        <Card className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </Card>
      ) : tree.length === 0 ? (
        <Card>
          <EmptyState title="No tags created yet" />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {tree.map((group) => {
            const pRes = group.parentResource;
            const pMeta = pRes ? meta.get("tag", pRes.id) : undefined;
            const isEditingParent = pRes && editId === pRes.id;

            return (
              <Card key={group.parent} className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {isEditingParent ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        updateMut.mutate({ id: pRes.id, tag: editValue });
                      }}
                      className="flex flex-1 items-center gap-2"
                    >
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                      <Button type="submit" size="icon">
                        <Check className="size-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" onClick={() => setEditId(null)}>
                        <X className="size-4" />
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <ResourceIconBadge entityType="tag" entityId={pRes?.id ?? group.parent} defaultIcon="Tags" size="sm" />
                      <span className="font-semibold">#{group.parent}</span>
                      {group.subtags.length > 0 && (
                        <Badge tone="neutral">{group.subtags.length} sub-tags</Badge>
                      )}
                      {pMeta?.is_todo && <Badge tone="warning">To-Do</Badge>}
                    </div>
                  )}

                  {!isEditingParent && pRes && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateMeta.mutate({
                            entity_type: "tag",
                            entity_id: pRes.id,
                            is_todo: !pMeta?.is_todo,
                          })
                        }
                        title="Toggle To-Do checklist status"
                      >
                        {pMeta?.is_todo ? (
                          <CheckSquare className="size-4 text-primary" />
                        ) : (
                          <Square className="size-4 text-muted" />
                        )}
                        <span className="text-xs">To-Do</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditId(pRes.id);
                          setEditValue(pRes.attributes.tag);
                        }}
                        aria-label={`Rename ${group.parent}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => delMut.mutate(pRes.id)}
                        aria-label={`Delete ${group.parent}`}
                      >
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </div>
                  )}
                </div>

                {group.subtags.length > 0 && (
                  <ul className="divide-y divide-border border-t border-border pt-2 pl-4">
                    {group.subtags.map(({ sub, full, resource }) => {
                      const sMeta = meta.get("tag", resource.id);
                      const isEditingSub = editId === resource.id;
                      return (
                        <li key={resource.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          {isEditingSub ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                updateMut.mutate({ id: resource.id, tag: formatTagName(group.parent, editValue) });
                              }}
                              className="flex flex-1 items-center gap-2"
                            >
                              <span className="text-xs text-muted">{group.parent} :</span>
                              <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                              <Button type="submit" size="icon">
                                <Check className="size-4" />
                              </Button>
                              <Button type="button" size="icon" variant="ghost" onClick={() => setEditId(null)}>
                                <X className="size-4" />
                              </Button>
                            </form>
                          ) : (
                            <div className="flex items-center gap-2">
                              <ResourceIconBadge entityType="tag" entityId={resource.id} defaultIcon="Tags" size="sm" />
                              <span className="text-muted">#{group.parent}</span>
                              <ChevronRight className="size-3.5 text-muted" aria-hidden />
                              <span className="font-medium">{sub}</span>
                              {sMeta?.is_todo && <Badge tone="warning">To-Do</Badge>}
                            </div>
                          )}

                          {!isEditingSub && (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  updateMeta.mutate({
                                    entity_type: "tag",
                                    entity_id: resource.id,
                                    is_todo: !sMeta?.is_todo,
                                  })
                                }
                              >
                                {sMeta?.is_todo ? (
                                  <CheckSquare className="size-4 text-primary" />
                                ) : (
                                  <Square className="size-4 text-muted" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditId(resource.id);
                                  setEditValue(sub);
                                }}
                                aria-label={`Rename ${full}`}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => delMut.mutate(resource.id)}
                                aria-label={`Delete ${full}`}
                              >
                                <Trash2 className="size-4 text-danger" />
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
