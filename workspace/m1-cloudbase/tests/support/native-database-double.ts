import type { JsonValue } from '../../src/shared/protocol';
import type {
  CloudBaseNativeDatabasePort,
  CloudBaseNativeTransactionPort,
} from '../../src/repositories/cloudbase-document-database';
import type { DocumentData, VersionedDocument } from '../../src/repositories/document-database-port';

type NativeState = Map<string, Map<string, DocumentData>>;

export class NativeDatabaseDouble implements CloudBaseNativeDatabasePort {
  private state: NativeState;
  public nextGetFailure: unknown;
  public nextCommitFailure: unknown;
  public serializeReadsAsListObject = false;
  public serializeNumbersAsExtendedJson = false;
  public readonly setPayloads: DocumentData[] = [];

  public constructor(seed: Readonly<Record<string, readonly VersionedDocument[]>> = {}) {
    this.state = new Map(Object.entries(seed).map(([collection, documents]) => [
      collection,
      new Map(documents.map((document) => [document._id, cloneData(document)])),
    ]));
  }

  public collection(name: string): NativeCollectionDouble {
    return new NativeCollectionDouble(
      this.state,
      name,
      () => this.takeGetFailure(),
      this.setPayloads,
      () => this.serializeReadsAsListObject,
      () => this.serializeNumbersAsExtendedJson,
    );
  }

  public async runTransaction<T>(work: (transaction: CloudBaseNativeTransactionPort) => Promise<T>): Promise<T> {
    const working = cloneState(this.state);
    const result = await work({
      collection: (name: string) => new NativeCollectionDouble(
        working,
        name,
        () => this.takeGetFailure(),
        this.setPayloads,
        () => this.serializeReadsAsListObject,
        () => this.serializeNumbersAsExtendedJson,
      ),
    });
    if (this.nextCommitFailure !== undefined) {
      const failure = this.nextCommitFailure;
      this.nextCommitFailure = undefined;
      throw failure;
    }
    this.state = working;
    return result;
  }

  public snapshot(collection: string): readonly DocumentData[] {
    return [...(this.state.get(collection)?.values() ?? [])].map(cloneData);
  }

  private takeGetFailure(): unknown {
    const failure = this.nextGetFailure;
    this.nextGetFailure = undefined;
    return failure;
  }
}

class NativeCollectionDouble {
  public constructor(
    private readonly state: NativeState,
    private readonly name: string,
    private readonly takeGetFailure: () => unknown,
    private readonly setPayloads: DocumentData[],
    private readonly serializeReadsAsListObject: () => boolean,
    private readonly serializeNumbersAsExtendedJson: () => boolean,
  ) {}

  public doc(documentId: string): NativeDocumentDouble {
    return new NativeDocumentDouble(
      this.state,
      this.name,
      documentId,
      this.takeGetFailure,
      this.setPayloads,
      this.serializeReadsAsListObject,
      this.serializeNumbersAsExtendedJson,
    );
  }

  public where(criteria: DocumentData): NativeQueryDouble {
    return new NativeQueryDouble(
      this.state,
      this.name,
      criteria,
      this.takeGetFailure,
      this.serializeReadsAsListObject,
      this.serializeNumbersAsExtendedJson,
    );
  }
}

class NativeDocumentDouble {
  public constructor(
    private readonly state: NativeState,
    private readonly collection: string,
    private readonly documentId: string,
    private readonly takeGetFailure: () => unknown,
    private readonly setPayloads: DocumentData[],
    private readonly serializeReadsAsListObject: () => boolean,
    private readonly serializeNumbersAsExtendedJson: () => boolean,
  ) {}

  public async get(): Promise<Readonly<{ data?: unknown }>> {
    const failure = this.takeGetFailure();
    if (failure !== undefined) throw failure;
    const found = this.state.get(this.collection)?.get(this.documentId);
    if (!this.serializeReadsAsListObject()) {
      return found === undefined ? { data: [] } : { data: cloneData(found) };
    }
    return {
      data: JSON.stringify(toSerializedData(
        { list: found === undefined ? [] : [cloneData(found)] },
        this.serializeNumbersAsExtendedJson(),
      )),
    };
  }

  public async set(input: DocumentData): Promise<void> {
    if ('_id' in input) throw new Error('CloudBase set payload must not contain _id.');
    this.setPayloads.push(cloneData(input));
    collection(this.state, this.collection).set(this.documentId, {
      _id: this.documentId,
      ...cloneData(input),
    });
  }

  public async create(input: DocumentData): Promise<void> {
    if ('_id' in input) throw new Error('CloudBase create payload must not contain _id.');
    if (this.state.get(this.collection)?.has(this.documentId) === true) {
      const error = new Error('document already exists') as Error & { code: string };
      error.code = 'DATABASE_DUPLICATE_KEY';
      throw error;
    }
    this.setPayloads.push(cloneData(input));
    collection(this.state, this.collection).set(this.documentId, {
      _id: this.documentId,
      ...cloneData(input),
    });
  }

  public async remove(): Promise<void> {
    this.state.get(this.collection)?.delete(this.documentId);
  }
}

class NativeQueryDouble {
  private pageSize = 100;
  private offset = 0;
  private orderField: string | null = null;
  private orderDirection: 'asc' | 'desc' = 'asc';

  public constructor(
    private readonly state: NativeState,
    private readonly collectionName: string,
    private readonly criteria: DocumentData,
    private readonly takeGetFailure: () => unknown,
    private readonly serializeReadsAsListObject: () => boolean,
    private readonly serializeNumbersAsExtendedJson: () => boolean,
  ) {}

  public limit(size: number): NativeQueryDouble {
    this.pageSize = size;
    return this;
  }

  public orderBy(field: string, direction: 'asc' | 'desc'): NativeQueryDouble {
    this.orderField = field;
    this.orderDirection = direction;
    return this;
  }

  public skip(offset: number): NativeQueryDouble {
    this.offset = offset;
    return this;
  }

  public async get(): Promise<Readonly<{ data: readonly DocumentData[] }>> {
    const failure = this.takeGetFailure();
    if (failure !== undefined) throw failure;
    const rows = [...(this.state.get(this.collectionName)?.values() ?? [])]
      .filter((document) => Object.entries(this.criteria).every(([key, value]) => equalJson(document[key], value)))
      .sort((left, right) => compareOrder(left, right, this.orderField, this.orderDirection))
      .slice(this.offset, this.offset + this.pageSize)
      .map(cloneData);
    return this.serializeReadsAsListObject()
      ? { data: JSON.stringify(toSerializedData({ list: rows }, this.serializeNumbersAsExtendedJson())) }
      : { data: rows };
  }
}

function compareOrder(
  left: DocumentData,
  right: DocumentData,
  field: string | null,
  direction: 'asc' | 'desc',
): number {
  if (field === null) return 0;
  const leftValue = left[field];
  const rightValue = right[field];
  if (typeof leftValue !== 'string' || typeof rightValue !== 'string') return 0;
  const result = leftValue.localeCompare(rightValue);
  return direction === 'asc' ? result : -result;
}

function collection(state: NativeState, name: string): Map<string, DocumentData> {
  const current = state.get(name);
  if (current !== undefined) return current;
  const created = new Map<string, DocumentData>();
  state.set(name, created);
  return created;
}

function cloneState(state: NativeState): NativeState {
  return new Map([...state.entries()].map(([name, documents]) => [
    name,
    new Map([...documents.entries()].map(([id, document]) => [id, cloneData(document)])),
  ]));
}

function cloneData(data: DocumentData): DocumentData {
  return cloneJson(data) as DocumentData;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function toSerializedData(value: JsonValue, extendedNumbers: boolean): JsonValue {
  if (!extendedNumbers) return value;
  if (Array.isArray(value)) return value.map((item) => toSerializedData(item, extendedNumbers));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toSerializedData(item, extendedNumbers)]));
  }
  return typeof value === 'number' && Number.isInteger(value)
    ? { $numberInt: String(value) }
    : value;
}

function equalJson(left: JsonValue | undefined, right: JsonValue): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
