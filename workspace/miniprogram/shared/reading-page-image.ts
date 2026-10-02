export function displayPageImageUrl(assetKey: string): string {
  if (assetKey.startsWith('https://') || assetKey.startsWith('http://') || assetKey.startsWith('cloud://') || assetKey.startsWith('/')) {
    return assetKey
  }
  if (assetKey === 'demo-zoo-page-01' || assetKey.startsWith('demo/reading/zoo/page-01-')
    || assetKey.startsWith('demo/page-01-')) {
    return '/assets/content/demo-zoo-picture-book-cover-v1.jpg'
  }
  if (assetKey === 'demo-zoo-page-02' || assetKey.startsWith('demo/reading/zoo/page-02-')
    || assetKey.startsWith('demo/page-02-') || assetKey === 'demo/image' || assetKey === 'demo/thumb') {
    return '/assets/content/demo-zoo-page-02-v1.jpg'
  }
  return ''
}
