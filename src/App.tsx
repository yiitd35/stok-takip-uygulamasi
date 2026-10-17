import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

type Product = {
  id: number
  name: string
  sku: string
  categories: string[]
  stock: number
  unit: string
  image?: string
}

const initialProducts: Product[] = [
  { id: 1, name: 'Kablosuz Kulaklık', sku: 'ELK-001', categories: ['Elektronik'], stock: 42, unit: 'adet' },
  { id: 2, name: 'Organik Kahve 1kg', sku: 'GDA-014', categories: ['Gıda'], stock: 18, unit: 'paket' },
  { id: 3, name: 'Keten Gömlek', sku: 'GYS-032', categories: ['Giyim'], stock: 7, unit: 'adet' },
  { id: 4, name: 'Çelik Termos', sku: 'EV-008', categories: ['Ev & Yaşam'], stock: 24, unit: 'adet' },
  { id: 5, name: 'Bluetooth Hoparlör', sku: 'ELK-019', categories: ['Elektronik'], stock: 3, unit: 'adet' },
]

function App() {
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('stok-takip-products')
    if (!saved) return initialProducts
    try {
      return JSON.parse(saved) as Product[]
    } catch {
      return initialProducts
    }
  })
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Tümü')
  const [productCategories, setProductCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem('stok-takip-categories')
    if (!saved) return ['Elektronik', 'Gıda', 'Giyim', 'Ev & Yaşam']
    try {
      return JSON.parse(saved) as string[]
    } catch {
      return ['Elektronik', 'Gıda', 'Giyim', 'Ev & Yaşam']
    }
  })
  const [newCategory, setNewCategory] = useState('')
  const [activeView, setActiveView] = useState<'overview' | 'admin'>('overview')
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [isCloudReady, setIsCloudReady] = useState(false)

  const categories = ['Tümü', ...productCategories]
  const visibleProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchesSearch = `${product.name} ${product.sku}`.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR'))
        return matchesSearch && (category === 'Tümü' || product.categories.includes(category))
      }),
    [products, search, category],
  )

  const lowStockCount = products.filter((product) => product.stock <= 5).length

  useEffect(() => {
    let cancelled = false
    async function loadCloudData() {
      const [{ data: cloudProducts, error: productsError }, { data: cloudCategories, error: categoriesError }] = await Promise.all([
        supabase.from('products').select('id, name, sku, stock, unit, image'),
        supabase.from('categories').select('id, name').order('name'),
      ])
      if (productsError || categoriesError) {
        console.error('Supabase verileri okunamadı.', productsError || categoriesError)
        setNotice('Bulut verilerine ulaşılamadı; yerel veriler gösteriliyor.')
        setIsCloudReady(true)
        return
      }
      if (cancelled) return
      const categoryRows = cloudCategories ?? []
      const productRows = cloudProducts ?? []
      const { data: links, error: linksError } = await supabase.from('product_categories').select('product_id, category_id')
      if (linksError) {
        console.error('Ürün kategorileri okunamadı.', linksError)
        setIsCloudReady(true)
        return
      }
      const categoryNames = new Map(categoryRows.map((item) => [item.id, item.name]))
      if (productRows.length > 0) {
        setProducts(productRows.map((item) => ({
          id: Number(item.id),
          name: item.name,
          sku: item.sku,
          categories: (links ?? []).filter((link) => link.product_id === item.id).map((link) => categoryNames.get(link.category_id)).filter((name): name is string => Boolean(name)),
          stock: item.stock,
          unit: item.unit,
          image: item.image ?? undefined,
        })))
      }
      setProductCategories(categoryRows.map((item) => item.name))
      setIsCloudReady(true)
    }
    void loadCloudData()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isCloudReady) return
    async function syncCloudData() {
      const { error: categoryError } = await supabase.from('categories').upsert(productCategories.map((name) => ({ name })), { onConflict: 'name' })
      if (categoryError) {
        console.error('Kategoriler buluta kaydedilemedi.', categoryError)
        return
      }
      const { data: categoryRows, error: categoryReadError } = await supabase.from('categories').select('id, name')
      if (categoryReadError) {
        console.error('Kategori kimlikleri okunamadı.', categoryReadError)
        return
      }
      const categoryIds = new Map((categoryRows ?? []).map((item) => [item.name, item.id]))
      const { error: productError } = await supabase.from('products').upsert(products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        stock: product.stock,
        unit: product.unit,
        image: product.image ?? null,
      })))
      if (productError) {
        console.error('Ürünler buluta kaydedilemedi.', productError)
        return
      }
      const { data: cloudProducts } = await supabase.from('products').select('id')
      const activeIds = products.map((product) => product.id)
      const staleIds = (cloudProducts ?? []).map((product) => product.id).filter((id) => !activeIds.includes(Number(id)))
      if (staleIds.length > 0) await supabase.from('products').delete().in('id', staleIds)
      await supabase.from('product_categories').delete().in('product_id', activeIds.length ? activeIds : [-1])
      const links = products.flatMap((product) => product.categories.map((name) => ({ product_id: product.id, category_id: categoryIds.get(name) })).filter((link): link is { product_id: number, category_id: number } => typeof link.category_id === 'number'))
      if (links.length > 0) await supabase.from('product_categories').insert(links)
    }
    void syncCloudData()
  }, [products, productCategories, isCloudReady])

  useEffect(() => {
    localStorage.setItem('stok-takip-products', JSON.stringify(products))
  }, [products])

  useEffect(() => {
    localStorage.setItem('stok-takip-categories', JSON.stringify(productCategories))
  }, [productCategories])
  const currentHour = new Date().getHours()
  const greeting = currentHour >= 5 && currentHour < 12
    ? 'Günaydın'
    : currentHour >= 12 && currentHour < 18
      ? 'İyi günler'
      : currentHour >= 18 && currentHour < 23
        ? 'İyi akşamlar'
        : 'İyi geceler'

  async function addProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const imageFile = data.get('image')
    const image = imageFile instanceof File && imageFile.size > 0
      ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Fotoğraf okunamadı.'))
        reader.readAsDataURL(imageFile)
      })
      : undefined
    const product: Product = {
      id: Date.now(),
      name: String(data.get('name')),
      sku: String(data.get('sku')).toUpperCase(),
      categories: data.getAll('categories').map(String).length ? data.getAll('categories').map(String) : [productCategories[0]],
      stock: Number(data.get('stock')),
      unit: 'adet',
      image,
    }

    setProducts((current) => [product, ...current])
    setIsModalOpen(false)
    setNotice('Ürün başarıyla eklendi.')
    event.currentTarget.reset()
    window.setTimeout(() => setNotice(''), 3000)
  }

  function addCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = newCategory.trim()
    if (!value || productCategories.some((item) => item.toLocaleLowerCase('tr-TR') === value.toLocaleLowerCase('tr-TR'))) return
    setProductCategories((current) => [...current, value])
    setNewCategory('')
  }

  function deleteCategory(value: string) {
    if (productCategories.length === 1) return
    setProductCategories((current) => current.filter((item) => item !== value))
    setProducts((current) => current.map((product) => {
      const next = product.categories.filter((item) => item !== value)
      return { ...product, categories: next.length ? next : [productCategories.find((item) => item !== value) || 'Diğer'] }
    }))
    if (category === value) setCategory('Tümü')
  }

  function setStock(id: number, value: string) {
    const stock = Number(value)
    if (!Number.isFinite(stock) || stock < 0) return
    setProducts((current) => current.map((product) => product.id === id ? { ...product, stock } : product))
  }

  function deleteProduct(product: Product) {
    if (!window.confirm(`"${product.name}" ürününü silmek istediğinize emin misiniz?`)) return
    setProducts((current) => current.filter((item) => item.id !== product.id))
    setNotice('Ürün silindi.')
    window.setTimeout(() => setNotice(''), 3000)
  }

  function openAdmin() {
    if (isAdminAuthenticated) {
      setActiveView('admin')
      return
    }
    setLoginError('')
    setIsLoginOpen(true)
  }

  function loginAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = String(new FormData(event.currentTarget).get('password'))
    if (password !== 'ygtdgny') {
      setLoginError('Şifre hatalı. Lütfen tekrar deneyin.')
      return
    }
    setIsAdminAuthenticated(true)
    setIsLoginOpen(false)
    setActiveView('admin')
    setLoginError('')
    event.currentTarget.reset()
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">✦</span><span>stok<span className="brand-dot">.</span></span></div>
        <p className="menu-label">MENÜ</p>
        <nav>
          <button className={`nav-item ${activeView === 'overview' ? 'active' : ''}`} onClick={() => setActiveView('overview')}><span>▦</span> Genel Bakış</button>
          <button className={`nav-item ${activeView === 'admin' ? 'active' : ''}`} onClick={openAdmin}><span>⚿</span> Admin</button>
          <button className="nav-item"><span>◫</span> Raporlar</button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><span>⚙</span> Ayarlar</button>
          <div className="profile"><div className="avatar">U</div><div><strong>ucuzaspor</strong><small>Yönetici</small></div><span className="more">•••</span></div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar"><div className="breadcrumbs">Genel Bakış <span>/</span> <b>Stok Özeti</b></div><div className="top-actions"><button className="icon-button">⌕</button><button className="icon-button notification">♧<i /></button><div className="date">17 Ekim 2026 <span>⌄</span></div></div></header>
        {activeView === 'overview' ? <><section className="page-heading"><div><p className="eyebrow">CUMARTESİ, 17 EKİM 2026</p><h1>{greeting}, ucuzaspor <span>✦</span></h1><p className="subtitle">İşletmenizin stok durumu bugün nasıl görünüyor?</p></div></section>

        <section className="stat-grid">
          <div className="stat-card"><div className="stat-icon violet">▤</div><div><p>Toplam Ürün</p><strong>{products.length}</strong><small className="positive">↑ %12.5 <em>geçen aya göre</em></small></div></div>
          <div className="stat-card"><div className="stat-icon green">▥</div><div><p>Toplam Stok</p><strong>{products.reduce((sum, product) => sum + product.stock, 0)}</strong><small className="positive">↑ %8.2 <em>geçen aya göre</em></small></div></div>
          <div className="stat-card"><div className="stat-icon orange">!</div><div><p>Kritik Stok</p><strong>{lowStockCount}</strong><small className="warning">Dikkat gerektiren ürün</small></div></div>
        </section></> : <section className="admin-page"><div className="page-heading"><div><p className="eyebrow">YÖNETİM PANELİ</p><h1>Stok yönetimi</h1><p className="subtitle">Ürünleri ekleyin, stok miktarlarını güncelleyin veya silin.</p></div><button className="primary-button" onClick={() => setIsModalOpen(true)}><span>＋</span> Yeni Ürün Ekle</button></div><div className="admin-notice"><span>⚿</span><div><strong>Admin yetkisi aktif</strong><p>Ürün, stok, kategori ve fotoğraf düzenlemeleri bu alandan yapılır.</p></div></div><div className="category-manager"><div><strong>Kategoriler</strong><p>Ürünlerde kullanılacak kategorileri yönetin.</p></div><form onSubmit={addCategory}><input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Yeni kategori adı" /><button className="primary-button" type="submit">Ekle</button></form><div className="category-chips">{productCategories.map((item) => <span key={item}>{item}<button type="button" onClick={() => deleteCategory(item)} aria-label={`${item} kategorisini sil`}>×</button></span>)}</div></div><div className="admin-list">{products.map((product) => <div className="admin-row" key={product.id}>{product.image ? <img className="product-image uploaded-image" src={product.image} alt="" /> : <div className={`product-image image-${product.id}`}>{product.categories[0] === 'Gıda' ? '☕' : product.categories[0] === 'Giyim' ? '♧' : product.categories[0] === 'Ev & Yaşam' ? '▱' : '◉'}</div>}<div className="admin-product"><strong>{product.name}</strong><small>{product.sku} · {product.categories.join(', ')}</small></div><label className="stock-input">Stok miktarı<input type="number" min="0" value={product.stock} onChange={(event) => setStock(product.id, event.target.value)} /><span>{product.unit}</span></label><button className="delete-button" onClick={() => deleteProduct(product)} aria-label={`${product.name} ürününü sil`}>Sil</button></div>)}</div></section>}

        {activeView === 'overview' && <section className="table-card">
          <div className="table-header"><div><h2>Ürünler</h2><p>Stok durumunuzu buradan yönetin.</p></div><div className="filters"><label className="search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ürün ara..." /></label><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select><button className="filter-button">≡ Filtrele</button></div></div>
          <div className="table-wrap"><table><thead><tr><th>ÜRÜN</th><th>KATEGORİLER</th><th>MEVCUT MİKTAR</th></tr></thead><tbody>{visibleProducts.map((product) => <tr key={product.id}><td><div className="product-cell">{product.image ? <img className="product-image uploaded-image" src={product.image} alt="" /> : <div className={`product-image image-${product.id}`}>◉</div>}<div><strong>{product.name}</strong><small>{product.sku}</small></div></div></td><td><div className="category-tags">{product.categories.map((item) => <span className="category-tag" key={item}>{item}</span>)}</div></td><td><div className="stock-cell"><strong className={product.stock <= 5 ? 'low' : ''}>{product.stock} {product.unit}</strong><span className="stock-bar"><i style={{ width: `${Math.min(product.stock * 2, 100)}%` }} className={product.stock <= 5 ? 'low-bar' : ''} /></span></div></td></tr>)}</tbody></table>{visibleProducts.length === 0 && <div className="empty">Aramanızla eşleşen ürün bulunamadı.</div>}</div>
          <div className="table-footer"><span>Toplam <b>{visibleProducts.length}</b> ürün gösteriliyor</span><div className="pagination"><button disabled>‹</button><button className="selected">1</button><button>2</button><button>›</button></div></div>
        </section>}
      </main>
      {notice && <div className="toast">✓ {notice}</div>}
      {isLoginOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsLoginOpen(false)}><form className="modal login-modal" onSubmit={loginAdmin}><div className="modal-heading"><div><p className="eyebrow">YETKİLİ ERİŞİM</p><h2>Admin girişi</h2></div><button type="button" onClick={() => setIsLoginOpen(false)}>×</button></div><p className="login-description">Ürün ve stok düzenlemeleri için admin şifrenizi girin.</p><label>Şifre<input name="password" required type="password" autoFocus placeholder="Admin şifresi" /></label>{loginError && <p className="login-error">{loginError}</p>}<button className="primary-button full" type="submit">Admin paneline gir</button></form></div>}
      {isModalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsModalOpen(false)}><form className="modal" onSubmit={addProduct}><div className="modal-heading"><div><p className="eyebrow">YENİ KAYIT</p><h2>Ürün ekle</h2></div><button type="button" onClick={() => setIsModalOpen(false)}>×</button></div><label>Ürün adı<input name="name" required placeholder="Örn. Masa lambası" /></label><label>Stok kodu<input name="sku" required placeholder="Örn. EV-024" /></label><fieldset className="category-picker"><legend>Kategoriler</legend>{productCategories.map((item) => <label key={item}><input type="checkbox" name="categories" value={item} defaultChecked={item === productCategories[0]} /> {item}</label>)}</fieldset><label className="photo-input">Ürün fotoğrafı<input name="image" type="file" accept="image/*" /></label><div className="form-row"><label>Başlangıç stoğu<input name="stock" required type="number" min="0" defaultValue="0" /></label></div><button className="primary-button full" type="submit">Ürünü Kaydet</button></form></div>}
    </div>
  )
}

export default App
