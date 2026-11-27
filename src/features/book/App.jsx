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

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, value) => setSession(value));
    return () => subscription.unsubscribe();
  }, []);

  async function refresh() {
    if (!supabase) return;
    const [e, b, l] = await Promise.all([
      supabase.from('story_entries').select('*').order('created_at'),
      supabase.from('books').select('*').limit(1).maybeSingle(),
      supabase.from('writing_locks').select('*').eq('id', 1).maybeSingle()
    ]);
    if (e.data) setEntries(e.data);
    if (b.data) setBook(b.data);
    if (l.data) setLock(l.data);
  }

  useEffect(() => {
    if (!session) return;
    refresh();
    const channel = supabase.channel('ortak-roman-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'story_entries' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'writing_locks' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books' }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session]);

  if (!supabase) return <SetupScreen />;

  const userId = session?.user?.id;
  const total = entries.reduce((sum, item) => sum + words(item.content), 0);
  const target = book?.target_words || APP_CONFIG.INITIAL_WORD_TARGET;
  const ownsLock = lock?.user_id === userId && new Date(lock.expires_at) > new Date();
  const otherLock = lock?.user_id && lock.user_id !== userId && new Date(lock.expires_at) > new Date();

  async function signIn(event) {
    event.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setNotice(error?.message || 'Giriş bağlantısı e-posta adresine gönderildi.');
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

  return <div className="app-shell">
    <header className="topbar"><a className="brand">✦ ORTAK <b>ROMAN</b></a>
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
        <span className="eyebrow">KİTABA KATIL</span><h2>Giriş bağlantısı al</h2>
        <p>Yalnızca davet edilen e-posta adresleriyle giriş yapabilirsin.</p>
        <form onSubmit={signIn} className="login-form"><input type="email" required placeholder="E-posta adresin" value={email} onChange={e => setEmail(e.target.value)} /><button className="button" disabled={busy}>Bağlantı gönder</button></form>
      </section> : <>
        <section className="panel">
          <span className="eyebrow">YAZMA SIRASI</span>
          <h2>{ownsLock ? 'Kalem sende' : otherLock ? (lock.display_name + ' yazıyor') : 'Sıradaki yazar sen olabilirsin'}</h2>
          <div className="writer-controls"><input maxLength={24} placeholder="Takma adın" value={name} onChange={e => setName(e.target.value)} />
            {ownsLock ? <button className="button light" onClick={release}>Sırayı bırak</button> : <button className="button" disabled={busy || !!otherLock} onClick={acquire}>Yazma sırasını al</button>}</div>
          {ownsLock && <><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Hikâyenin devamını buraya yaz..." />
            <div className="draft-actions"><span>{words(draft)} / {APP_CONFIG.LIMIT} kelime</span><button className="button" disabled={busy || !draft.trim() || words(draft) > APP_CONFIG.LIMIT} onClick={submit}>Katkıyı ekle</button></div></>}
        </section>
        <section className="panel story"><span className="eyebrow">ROMANIN ŞİMDİYE KADAR OLANI</span><h2>Hikâye</h2>
          {entries.length ? entries.map((entry, index) => <article className="entry" key={entry.id}><p>{entry.content}</p><footer>{entry.display_name} · {new Date(entry.created_at).toLocaleString('tr-TR')}</footer></article>) : <p>İlk cümleyi bekliyoruz. Hikâyeyi başlatmak için yazma sırasını al.</p>}
        </section>
      </>}
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Bildirimi kapat">×</button></div>}
    </main>
    <footer className="site-footer">ORTAK ROMAN <span>Birlikte yazılır.</span></footer>
  </div>;
}
