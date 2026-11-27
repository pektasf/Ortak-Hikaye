import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client.js';
import { APP_CONFIG } from '../../config/app.js';
import { words } from '../../lib/text.js';
import SetupScreen from '../../components/setup/SetupScreen.jsx';
import '../../styles/global.css';

export default function App() {
  const [session, setSession] = useState(null);
  const [entries, setEntries] = useState([]);
  const [lock, setLock] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [book, setBook] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState('writer');
  const [inviteLink, setInviteLink] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (invite) {
      window.localStorage.setItem('ortak_roman_invite', invite);
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, value) => setSession(value));
    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  const ownsLock = Boolean(lock?.user_id === userId && lock?.expires_at && new Date(lock.expires_at) > new Date());

  useEffect(() => {
    if (!supabase || !session) {
      setAuthorized(false);
      return;
    }
    let active = true;
    async function checkAccess() {
      const invite = window.localStorage.getItem('ortak_roman_invite');
      if (invite) {
        const { error } = await supabase.rpc('redeem_invite', { p_token: invite });
        window.localStorage.removeItem('ortak_roman_invite');
        if (error && active) setNotice('Davet bağlantısı doğrulanamadı: ' + error.message);
      }
      const { data, error } = await supabase.from('profiles')
        .select('access_granted, role, display_name').eq('id', session.user.id).maybeSingle();
      if (!active) return;
      if (error) setNotice('Üyelik kontrolü yapılamadı: ' + error.message);
      setAuthorized(Boolean(data?.access_granted));
      setRole(data?.role || 'writer');
      if (data?.display_name && data.display_name !== 'Yazar') setName(data.display_name);
      if (!data?.access_granted) setNotice('Bu hesap henüz davetle yetkilendirilmedi. Davet bağlantısını tekrar açıp giriş yap.');
    }
    checkAccess();
    return () => { active = false; };
  }, [session]);

  async function refresh() {
    if (!supabase || !session || !authorized) return;
    const [e, b, l] = await Promise.all([
      supabase.from('story_entries').select('*').order('created_at'),
      supabase.from('books').select('*').limit(1).maybeSingle(),
      supabase.from('writing_locks').select('*').eq('id', 1).maybeSingle()
    ]);
    if (e.error) setNotice(e.error.message);
    if (e.data) setEntries(e.data);
    if (b.data) setBook(b.data);
    if (l.data) setLock(l.data);
  }

  useEffect(() => {
    if (!supabase || !session || !authorized) return;
    refresh();
    const channel = supabase.channel('ortak-roman-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'story_entries' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'writing_locks' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books' }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, authorized]);

  useEffect(() => {
    if (!supabase || !ownsLock) return;
    const timer = window.setInterval(async () => {
      const { error } = await supabase.rpc('renew_writing_lock');
      if (error) setNotice(error.message);
    }, APP_CONFIG.HEARTBEAT);
    return () => window.clearInterval(timer);
  }, [ownsLock]);

  if (!supabase) return <SetupScreen />;

  const total = entries.reduce((sum, item) => sum + words(item.content), 0);
  const target = book?.target_words || APP_CONFIG.INITIAL_WORD_TARGET;
  const otherLock = Boolean(lock?.user_id && lock.user_id !== userId && lock.expires_at && new Date(lock.expires_at) > new Date());

  async function signIn(event) {
    event.preventDefault();
    const invite = window.localStorage.getItem('ortak_roman_invite');
    if (!invite) {
      setNotice('Giriş yapabilmek için önce davet bağlantısını açmalısın.');
      return;
    }
    setBusy(true);
    const redirect = window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(invite);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect, shouldCreateUser: true }
    });
    setNotice(error?.message || 'Giriş bağlantısı e-posta adresine gönderildi. Bağlantıyı aynı cihazda aç.');
    setBusy(false);
  }

  async function acquire() {
    if (!name.trim()) { setNotice('Önce takma adını yaz.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('acquire_writing_lock', { p_display_name: name.trim() });
    if (error) setNotice(error.message);
    else if (data?.ok) { setLock(data.lock); setNotice('Yazma sırası sende.'); }
    else setNotice(data?.message || 'Yazma sırası şu anda başkasında.');
    setBusy(false);
  }

  async function submit() {
    if (!draft.trim() || !ownsLock) return;
    setBusy(true);
    const { error } = await supabase.from('story_entries').insert({
      user_id: userId, display_name: name.trim() || session.user.email, content: draft.trim()
    });
    if (error) setNotice(error.message);
    else {
      setDraft('');
      await supabase.rpc('release_writing_lock');
      setNotice('Katkın kitaba eklendi.');
      await refresh();
    }
    setBusy(false);
  }

  async function release() {
    await supabase.rpc('release_writing_lock');
    await refresh();
    setNotice('Yazma sırası bırakıldı.');
  }

  async function makeInvite() {
    setBusy(true);
    const { data, error } = await supabase.rpc('create_invite', { p_max_uses: 10, p_hours_valid: 168 });
    if (error) setNotice('Davet oluşturulamadı: ' + error.message);
    else {
      const url = window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(data);
      setInviteLink(url);
      try { await navigator.clipboard.writeText(url); setNotice('10 kullanımlık, 7 gün geçerli davet bağlantısı oluşturuldu ve kopyalandı.'); }
      catch { setNotice('Davet bağlantısı oluşturuldu. Aşağıdan kopyalayabilirsin.'); }
    }
    setBusy(false);
  }

  if (session && !authorized) {
    return <div className="setup"><div className="setup-card">
      <small>ORTAK ROMAN · DAVET KONTROLÜ</small>
      <h1>Üyeliğin doğrulanıyor</h1>
      <p>{notice || 'Bu hesap için geçerli bir davet bağlantısı gerekli.'}</p>
      <p>Davet bağlantısını açtıktan sonra e-posta ile giriş işlemini yeniden başlat. Yöneticiysen ilk hesap yetkisini Supabase kurulum adımında tanımlamalısın.</p>
      <button className="button light" onClick={() => supabase.auth.signOut()}>Çıkış yap</button>
    </div></div>;
  }

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href={window.location.pathname}>✦ ORTAK <b>ROMAN</b></a>
      {session ? <div className="account"><span>{session.user.email}</span><button className="button light" onClick={async () => { await release(); await supabase.auth.signOut(); }}>Çıkış</button></div> : <span className="eyebrow">DAVETLİ YAZARLAR</span>}
    </header>
    <main className="content">
      <section className="hero">
        <div><span className="eyebrow">BİRLİKTE YAZILAN BİR HİKÂYE</span>
          <h1>{book?.title || 'Ortak Roman'}</h1><p>{book?.subtitle || 'Bir hikâye, birçok ses'}</p></div>
        <div className="word-count"><strong>{total.toLocaleString('tr-TR')}</strong><span> / {target.toLocaleString('tr-TR')} kelime</span></div>
      </section>
      <div className="progress"><i style={{ width: Math.min(100, total / target * 100) + '%' }} /></div>
      {!session ? <section className="panel">
        <span className="eyebrow">KİTABA KATIL</span><h2>Davet bağlantısıyla giriş yap</h2>
        <p>Bu roman yalnızca geçerli davet bağlantısına sahip kişilere açıktır. Davet bağlantısını açtıktan sonra e-posta adresine giriş bağlantısı gönder.</p>
        <form onSubmit={signIn} className="login-form"><input type="email" required placeholder="E-posta adresin" value={email} onChange={e => setEmail(e.target.value)} /><button className="button" disabled={busy}>Giriş bağlantısı gönder</button></form>
      </section> : <>
        {role === 'owner' && <section className="panel invite-panel">
          <span className="eyebrow">YÖNETİCİ · DAVETLER</span><h2>Yeni yazar davet et</h2>
          <p>Bağlantı 7 gün geçerlidir ve en fazla 10 yeni hesap tarafından kullanılabilir.</p>
          <button className="button" disabled={busy} onClick={makeInvite}>Davet bağlantısı oluştur</button>
          {inviteLink && <div className="invite-link"><input readOnly value={inviteLink} onFocus={e => e.target.select()} /><button className="button light" onClick={() => navigator.clipboard.writeText(inviteLink)}>Kopyala</button></div>}
        </section>}
        <section className="panel">
          <span className="eyebrow">YAZMA SIRASI</span>
          <h2>{ownsLock ? 'Kalem sende' : otherLock ? (lock.display_name + ' yazıyor') : 'Sıradaki yazar sen olabilirsin'}</h2>
          <div className="writer-controls"><input maxLength={24} placeholder="Takma adın" value={name} onChange={e => setName(e.target.value)} />
            {ownsLock ? <button className="button light" onClick={release}>Sırayı bırak</button> : <button className="button" disabled={busy || !!otherLock} onClick={acquire}>Yazma sırasını al</button>}</div>
          {ownsLock && <><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Hikâyenin devamını buraya yaz..." />
            <div className="draft-actions"><span>{words(draft)} / {APP_CONFIG.LIMIT} kelime</span><button className="button" disabled={busy || !draft.trim() || words(draft) > APP_CONFIG.LIMIT} onClick={submit}>Katkıyı ekle</button></div></>}
        </section>
        <section className="panel story"><span className="eyebrow">ROMANIN ŞİMDİYE KADAR OLANI</span><h2>Hikâye</h2>
          {entries.length ? entries.map(entry => <article className="entry" key={entry.id}><p>{entry.content}</p><footer>{entry.display_name} · {new Date(entry.created_at).toLocaleString('tr-TR')}</footer></article>) : <p>İlk cümleyi bekliyoruz. Hikâyeyi başlatmak için yazma sırasını al.</p>}
        </section>
      </>}
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Bildirimi kapat">×</button></div>}
    </main>
    <footer className="site-footer">ORTAK ROMAN <span>Birlikte yazılır.</span></footer>
  </div>;
}
