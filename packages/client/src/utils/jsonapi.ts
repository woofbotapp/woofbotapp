interface CursorPaginationLinks {
  next?: string;
}

interface JsonApiRelationshipData<T extends string> {
  type: T;
  id: string;
}

interface JsonApiRelationshipDataContainer<T extends string> {
  data: JsonApiRelationshipData<T>[]; // only one-to-many relationships
}

interface JsonApiData<Attributes, T extends string> extends JsonApiRelationshipData<T> {
  attributes: Attributes;
}

interface JsonApiDataWithRelationships<
  Attributes, T extends string, K extends string, R extends string
> extends JsonApiData<Attributes, T> {
  relationships: Record<K, JsonApiRelationshipDataContainer<R>>;
}

export interface CursorPaginationLinksContainer {
  links: CursorPaginationLinks;
}

export interface CursorPaginationBody<
  Attributes, T extends string
> extends CursorPaginationLinksContainer {
  data: JsonApiData<Attributes, T>[];
}

export interface BodyWithRelationships<
  Attributes, T extends string, K extends string,
  Attributes1 = never, T1 extends string = never,
  Attributes2 = never, T2 extends string = never,
  Attributes3 = never, T3 extends string = never,
> {
  data: JsonApiDataWithRelationships<Attributes, T, K, T1 | T2 | T3>;
  included: (
    JsonApiData<Attributes1, T1> |
    JsonApiData<Attributes2, T2> |
    JsonApiData<Attributes3, T3>
  )[],
}
