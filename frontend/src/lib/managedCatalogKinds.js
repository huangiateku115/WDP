// Shared shape of the two managed-inventory catalog kinds. The list screen and the
// create/edit route read the same config so a new kind is added in exactly one place.
// Endpoint names match `bomManagedInventoryCatalogApi` (backend routes
// `/managed-inventory-catalog/{categories,quantity-units}`).
export const CATALOG_KINDS = {
  category: {
    title: 'Danh mục hàng hóa',
    plural: 'Danh mục',
    codeMax: 48,
    nameMax: 120,
    codePlaceholder: 'VD: VAN_PHONG',
    list: 'listCategories',
    get: 'getCategory',
    create: 'createCategory',
    update: 'updateCategory',
    remove: 'removeCategory',
  },
  quantityUnit: {
    title: 'Đơn vị tính',
    plural: 'Đơn vị',
    codeMax: 32,
    nameMax: 80,
    codePlaceholder: 'VD: THUNG',
    list: 'listQuantityUnits',
    get: 'getQuantityUnit',
    create: 'createQuantityUnit',
    update: 'updateQuantityUnit',
    remove: 'removeQuantityUnit',
  },
};

export const CATALOG_KIND_KEYS = Object.keys(CATALOG_KINDS);

export const catalogConfig = (kind) => CATALOG_KINDS[kind] || null;

export const blankCatalogRecord = () => ({ code: '', name: '', description: '', sortOrder: 0, isActive: true });
