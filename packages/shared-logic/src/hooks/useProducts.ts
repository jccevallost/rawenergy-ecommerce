import { NetworkStatus, useQuery } from "@apollo/client";
import { useMutation } from "@apollo/client";
import { GET_PRODUCTS_BY_GOAL, SEARCH_PRODUCTS, UPSERT_PRODUCT } from "../graphql/operations";
import type { Product, ProductConnection, ProductFilters } from "../types";

const normalizeProduct = (product: Product): Product => ({
  ...product,
  variants: product.variants.map((variant) => ({
    ...variant,
    size: variant.size ?? { value: variant.sizeValue ?? 0, unit: variant.sizeUnit ?? "" }
  }))
});

export const useProductsByGoal = (goalSlug: string, limit = 4, options: { skip?: boolean } = {}) => {
  const query = useQuery<{ getProductsByGoal: Product[] }>(GET_PRODUCTS_BY_GOAL, {
    variables: { goalSlug, limit },
    skip: options.skip || !goalSlug
  });
  return { data: query.data?.getProductsByGoal.map(normalizeProduct) ?? [], loading: query.loading, error: query.error, refetch: query.refetch };
};

export const useProductSearch = (filters: ProductFilters, first = 12) => {
  const query = useQuery<{ searchProducts: ProductConnection }>(SEARCH_PRODUCTS, {
    variables: { filters, pagination: { first } },
    notifyOnNetworkStatusChange: true
  });
  const pageInfo = query.data?.searchProducts.pageInfo;
  const loadMore = () => {
    if (!pageInfo?.hasNextPage || query.loading) return;
    return query.fetchMore({ variables: { filters, pagination: { first, after: pageInfo.endCursor } } });
  };
  return {
    data: query.data?.searchProducts,
    products: query.data?.searchProducts.edges.map((edge) => normalizeProduct(edge.node)) ?? [],
    totalCount: query.data?.searchProducts.totalCount ?? 0,
    hasNextPage: pageInfo?.hasNextPage ?? false,
    loadingMore: query.networkStatus === NetworkStatus.fetchMore,
    loading: query.loading,
    error: query.error,
    refetch: query.refetch,
    loadMore
  };
};

export const useUpsertProduct = () => {
  const [mutate, state] = useMutation<{ upsertProduct: Pick<Product, "id" | "title" | "slug" | "priceRange"> }>(UPSERT_PRODUCT);
  return {
    saveProduct: (payload: unknown, id?: string, expectedStocks?: Array<{ sku: string; stock: number }>, expectedRevision?: number) => mutate({ variables: { id, payload, expectedStocks, expectedRevision }, refetchQueries: ["SearchProducts"] }),
    data: state.data?.upsertProduct,
    loading: state.loading,
    error: state.error,
    reset: state.reset
  };
};
