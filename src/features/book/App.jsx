import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client.js';
import { words } from '../../lib/text.js';
import SetupScreen from '../../components/setup/SetupScreen.jsx';
import '../../styles/global.css';

function paginateBookText(value, wordsPerPage = 175) {
  const paragraphs = String(value || '').split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
  const pages = [];
  let page = [];
  let pageWordCount = 0;
  const flush = () => {
    if (page.length) pages.push(page.join('\n\n'));
    page = [];
    pageWordCount = 0;
  };
  for (const paragraph of paragraphs) {
    const tokens = paragraph.split(/\s+/);
    let part = [];
    for (const token of tokens) {
      if (pageWordCount >= wordsPerPage) {
        if (part.length) { page.push(part.join(' ')); part = []; }
        flush();
      }
      part.push(token);
      pageWordCount += 1;
    }
    if (part.length) page.push(part.join(' '));
    if (pageWordCount >= wordsPerPage) flush();
  }
  flush();
  return pages;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState('writer');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [book, setBook] = useState(null);
  const [settings, setSettings] = useState({ title: '', subtitle: '', note: '', target_words: 1000, extension_words: 1000 });
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [stories, setStories] = useState([]);
  const [activeStoryId, setActiveStoryId] = useState('');
  const [chapters, setChapters] = useState([]);
  const [activeChapterId, setActiveChapterId] = useState('');
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorBlocks, setEditorBlocks] = useState([]);
  const [editorStatus, setEditorStatus] = useState('draft');
  const [editorDirty, setEditorDirty] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [newStoryDescription, setNewStoryDescription] = useState('');
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyInviteLinks, setStoryInviteLinks] = useState({});
  const [revisions, setRevisions] = useState([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [writingWidth, setWritingWidth] = useState('notebook');
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({ display_name: '', bio: '' });
  const [profileBusy, setProfileBusy] = useState(false);
  const [discoverAuthors, setDiscoverAuthors] = useState([]);
  const [authorQuery, setAuthorQuery] = useState('');
  const [publicProfileId, setPublicProfileId] = useState(null);
  const [readingIndex, setReadingIndex] = useState(0);
  const [writingLock, setWritingLock] = useState(null);
  const [lockNotice, setLockNotice] = useState('');
  const [view, setView] = useState('home');
  const [writingFont, setWritingFont] = useState('serif');
  const [writingSize, setWritingSize] = useState('20');
  const [writingLineHeight, setWritingLineHeight] = useState('1.9');
  const [readerLayout, setReaderLayout] = useState('spread');
  const [readerPageIndex, setReaderPageIndex] = useState(0);
  const [readerTurn, setReaderTurn] = useState(null);

  const userId = session?.user?.id;
  const activeStory = stories.find(item => item.id === activeStoryId) || null;
  const activeChapter = chapters.find(item => item.id === activeChapterId) || null;
  const isStoryOwner = Boolean(activeStory && activeStory.owner_id === userId);

  async function loadChapterBlocks(chapterId) {
    const { data, error } = await supabase.from('chapter_blocks')
      .select('id,content,author_id,updated_by,position').eq('chapter_id', chapterId).order('position');
    if (error) { setNotice('Paragraflar yüklenemedi: ' + error.message); return []; }
    const { data: authors } = await supabase.rpc('get_story_author_names', { p_chapter_id: chapterId });
    const names = Object.fromEntries((authors || []).map(item => [item.user_id, item.display_name]));
    const blocks = (data || []).map(block => ({...block,author_name:names[block.author_id] || (block.author_id ? 'Yazar' : 'Eski metin'),editor_name:names[block.updated_by] || 'Yazar'}));
    setEditorBlocks(blocks);
    setEditorContent(blocks.map(block => block.content).join('\n\n') || '');
    return blocks;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storyInvite = params.get('story_invite');
    const setup = params.get('setup');
    if (storyInvite) window.localStorage.setItem('ortak_roman_story_invite', storyInvite);
    if (setup === '1') window.localStorage.setItem('ortak_roman_bootstrap', '1');
    if (storyInvite || setup) window.history.replaceState({}, '', window.location.pathname);
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, value) => setSession(value));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setAuthorized(false);
      setStories([]);
      setChapters([]);
      setActiveStoryId('');
      return;
    }
    let active = true;
    async function checkAccess() {
      const token = window.localStorage.getItem('ortak_roman_story_invite');
      if (token) {
        const { error } = await supabase.rpc('redeem_story_invite', { p_token: token });
        window.localStorage.removeItem('ortak_roman_story_invite');
        if (error && active) setNotice('Hikâye daveti doğrulanamadı: ' + error.message);
      }
      window.localStorage.removeItem('ortak_roman_bootstrap');
      const [{ data: profile, error: profileError }, { data: memberships, error: membershipError }] = await Promise.all([
        supabase.from('profiles').select('role,display_name').eq('id', session.user.id).maybeSingle(),
        supabase.from('story_members').select('story_id,role').eq('user_id', session.user.id)
      ]);
      if (!active) return;
      if (profileError) setNotice('Profil kontrolü yapılamadı: ' + profileError.message);
      if (membershipError) setNotice('Hikâye üyeliği kontrol edilemedi: ' + membershipError.message);
      const nextRole = profile?.role || 'writer';
      const allowed = ['owner', 'moderator'].includes(nextRole) || Boolean(memberships?.length);
      setRole(nextRole);
      setAuthorized(allowed);
      if (profile?.display_name && profile.display_name !== 'Yazar') setName(profile.display_name);
      if (!allowed) setNotice('Bu hesap henüz bir hikâyeye üye değil. Geçerli hikâye davet bağlantısını açıp yeniden giriş yap.');
    }
    checkAccess();
    return () => { active = false; };
  }, [session]);

  async function refreshWorkspace() {
    if (!supabase || !session || !authorized) return;
    const [bookResult, storyResult] = await Promise.all([
      supabase.from('books').select('*').limit(1).maybeSingle(),
      supabase.from('stories').select('id,title,description,status,owner_id,target_words,created_at,updated_at').order('updated_at', { ascending: false })
    ]);
    if (bookResult.error) setNotice('Kitap bilgisi yüklenemedi: ' + bookResult.error.message);
    else if (bookResult.data) setBook(bookResult.data);
    if (storyResult.error) setNotice('Hikâyeler yüklenemedi: ' + storyResult.error.message);
    else {
      setStories(storyResult.data || []);
      setActiveStoryId(current => (storyResult.data || []).some(item => item.id === current) ? current : (storyResult.data?.[0]?.id || ''));
    }
  }

  async function refreshChapters(storyId = activeStoryId) {
    if (!supabase || !storyId) { setChapters([]); return; }
    const { data, error } = await supabase.from('chapters')
      .select('id,story_id,title,content,status,target_words,sort_order,created_by,created_at,updated_at')
      .eq('story_id', storyId).order('sort_order').order('created_at');
    if (error) setNotice('Bölümler yüklenemedi: ' + error.message);
    else {
      setChapters(data || []);
      const { data: progress } = await supabase.from('reading_progress')
        .select('chapter_id').eq('user_id', userId).eq('story_id', storyId).maybeSingle();
      setActiveChapterId(current => (data || []).some(item => item.id === current)
        ? current
        : ((data || []).some(item => item.id === progress?.chapter_id) ? progress.chapter_id : (data?.[0]?.id || '')));
    }
  }

  useEffect(() => {
    if (!authorized || !session) return;
    refreshWorkspace();
    const channel = supabase.channel('ortak-roman-workspace-' + session.user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, refreshWorkspace)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chapters' }, () => refreshChapters())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'story_members' }, refreshWorkspace)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, authorized]);

  useEffect(() => {
    if (!authorized || !activeStoryId) {
      setChapters([]);
      setActiveChapterId('');
      return;
    }
    setChapters([]);
    setActiveChapterId('');
    refreshChapters(activeStoryId);
  }, [activeStoryId, authorized]);

  useEffect(() => {
    if (!authorized || !userId || !activeStoryId || !activeChapterId) return;
    const chapter = chapters.find(item => item.id === activeChapterId);
    if (!chapter || chapter.story_id !== activeStoryId) return;
    supabase.from('reading_progress').upsert({
      user_id: userId, story_id: activeStoryId, chapter_id: activeChapterId, scroll_position: 0
    }, { onConflict: 'user_id,story_id' }).then(({ error }) => {
      if (error) setNotice('Okuma konumu kaydedilemedi: ' + error.message);
    });
  }, [activeChapterId, activeStoryId, authorized, userId, chapters]);

  useEffect(() => {
    if (!authorized || !focusMode || !activeChapterId || !userId) { setWritingLock(null); return; }
    let alive = true;
    let timer;
    let ownsLock = false;
    const acquire = async () => {
      const { data, error } = await supabase.rpc('acquire_chapter_writing_lock', { p_chapter_id: activeChapterId });
      if (!alive) return;
      if (error) { setWritingLock({ acquired:false, display_name:'Başka bir yazar', error:error.message }); return; }
      ownsLock = Boolean(data?.acquired && data.user_id === userId);
      setWritingLock(data);
      setLockNotice(data?.acquired ? '' : (data?.display_name || 'Bir yazar') + ' şu anda bu bölümü yazıyor.');
    };
    acquire();
    timer = window.setInterval(async () => {
      if (!alive) return;
      if (ownsLock) {
        const { data, error } = await supabase.rpc('renew_chapter_writing_lock', { p_chapter_id: activeChapterId });
        if (error || data !== true) { ownsLock=false; setWritingLock({ acquired:false, display_name:'Yazma oturumu sona erdi' }); }
      } else acquire();
    }, 12000);
    const channel = supabase.channel('chapter-lock-' + activeChapterId)
      .on('postgres_changes', { event:'*', schema:'public', table:'chapter_writing_locks', filter:'chapter_id=eq.' + activeChapterId }, () => acquire())
      .subscribe();
    return () => {
      alive=false;
      window.clearInterval(timer);
      supabase.removeChannel(channel);
      if (ownsLock) supabase.rpc('release_chapter_writing_lock', { p_chapter_id: activeChapterId });
    };
  }, [authorized, activeChapterId, userId, focusMode]);

  useEffect(() => {
    if (view === 'discover') loadDiscover('');
  }, [view]);

  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = event => {
      if (event.key === 'Escape') exitWritingStudio();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        document.querySelector('.chapter-editor')?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusMode, editorDirty]);

  useEffect(() => {
    if (!activeChapter || editorDirty) return;
    let cancelled = false;
    setEditorTitle(activeChapter.title);
    setEditorStatus(activeChapter.status || 'draft');
    loadChapterBlocks(activeChapter.id).then(loaded => {
      if (cancelled) return;
      if (!loaded.length && activeChapter.content) {
        const legacyBlocks = activeChapter.content.split(/\n\s*\n/).filter(Boolean).map(content => ({id:null,content,author_id:null,updated_by:null}));
        setEditorBlocks(legacyBlocks);
        setEditorContent(activeChapter.content);
      }
    });
    return () => { cancelled = true; };
  }, [activeChapterId, activeChapter?.updated_at, editorDirty]);

  useEffect(() => {
    if (!book || settingsDirty) return;
    setSettings({
      title: book.title || '', subtitle: book.subtitle || '', note: book.note || '',
      target_words: book.target_words || 1000, extension_words: book.extension_words || 1000
    });
  }, [book?.id, book?.title, book?.subtitle, book?.note, book?.target_words, book?.extension_words, settingsDirty]);

  if (!supabase) return <SetupScreen />;

  async function signIn(event) {
    event.preventDefault();
    const storyInvite = window.localStorage.getItem('ortak_roman_story_invite');
    const bootstrap = window.localStorage.getItem('ortak_roman_bootstrap') === '1';
    if (!storyInvite && !bootstrap) {
      setNotice('Giriş için önce hikâye davet bağlantısını açmalısın. Ana yönetici hesabı için site adresinin sonuna ?setup=1 ekle.');
      return;
    }
    setBusy(true);
    const redirect = window.location.origin + window.location.pathname +
      (storyInvite ? '?story_invite=' + encodeURIComponent(storyInvite) : '?setup=1');
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: redirect, shouldCreateUser: true }
    });
    setNotice(error?.message || 'Giriş bağlantısı e-posta adresine gönderildi. Bağlantıyı aynı cihazda aç.');
    setBusy(false);
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Davet bağlantısı kopyalandı.');
    } catch {
      setNotice('Bağlantıyı seçip kopyalayabilirsin.');
    }
  }

  async function createStory(event) {
    event.preventDefault();
    if (!newStoryTitle.trim() || !book?.id) return;
    setStoryBusy(true);
    const { data, error } = await supabase.rpc('create_story', {
      p_book_id: book.id, p_title: newStoryTitle.trim(),
      p_description: newStoryDescription.trim()
    });
    if (error) setNotice('Hikâye oluşturulamadı: ' + error.message);
    else {
      setStories(items => [data, ...items]);
      setActiveStoryId(data.id);
      setNewStoryTitle('');
      setNewStoryDescription('');
      setNotice('Hikâyen oluşturuldu. İlk bölümünü şimdi ekleyebilirsin.');
    }
    setStoryBusy(false);
  }

  async function openProfile(targetId = userId) {
    if (editorDirty && !window.confirm('Kaydedilmemiş bölüm değişikliklerin var. Profil sayfasına geçmek istiyor musun?')) return;
    setProfileBusy(true);
    const { data, error } = await supabase.rpc('get_author_profile', { p_user_id: targetId });
    if (error) setNotice('Profil yüklenemedi: ' + error.message);
    else {
      setProfile(data);
      setPublicProfileId(targetId);
      setProfileForm({ display_name: data.display_name || '', bio: data.bio || '' });
      setView('profile');
    }
    setProfileBusy(false);
  }

  async function loadDiscover(query = authorQuery) {
    const { data, error } = await supabase.rpc('search_author_profiles', { p_query: query, p_limit: 36 });
    if (error) setNotice('Yazarlar yüklenemedi: ' + error.message);
    else setDiscoverAuthors(data || []);
  }

  async function toggleFollow(targetId, currentlyFollowing) {
    if (!targetId || targetId === userId) return;
    const result = currentlyFollowing
      ? await supabase.from('author_follows').delete().eq('follower_id', userId).eq('followed_id', targetId)
      : await supabase.from('author_follows').insert({ follower_id: userId, followed_id: targetId });
    if (result.error) setNotice('Takip işlemi yapılamadı: ' + result.error.message);
    else {
      if (publicProfileId === targetId) await openProfile(targetId);
      await loadDiscover();
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setProfileBusy(true);
    const { data, error } = await supabase.rpc('update_author_profile', {
      p_display_name: profileForm.display_name.trim(), p_bio: profileForm.bio
    });
    if (error) setNotice('Profil kaydedilemedi: ' + error.message);
    else {
      setProfile(current => ({ ...current, ...data }));
      setName(data.display_name);
      setNotice('Profilin güncellendi.');
    }
    setProfileBusy(false);
  }

  async function deleteStory() {
    if (!activeStory || !isStoryOwner) return;
    if (editorDirty && !window.confirm('Kaydedilmemiş bölüm değişikliklerin var. Yine de hikâyeyi silmek istiyor musun?')) return;
    if (!window.confirm('“' + activeStory.title + '” kalıcı olarak silinecek. Bölümler, sürümler, davetler ve okuma ilerlemeleri de silinir. Bu işlem geri alınamaz. Devam edilsin mi?')) return;
    setStoryBusy(true);
    const { error } = await supabase.rpc('delete_story', { p_story_id: activeStory.id });
    if (error) setNotice('Hikâye silinemedi: ' + error.message);
    else {
      const remaining = stories.filter(item => item.id !== activeStory.id);
      setStories(remaining);
      setActiveStoryId(remaining[0]?.id || '');
      setChapters([]); setActiveChapterId('');
      setEditorTitle(''); setEditorContent(''); setEditorDirty(false); setFocusMode(false);
      setNotice('Hikâye ve ona bağlı kayıtlar silindi.');
    }
    setStoryBusy(false);
  }

  async function makeStoryInvite(storyId) {
    setStoryBusy(true);
    const { data, error } = await supabase.rpc('create_story_invite', {
      p_story_id: storyId, p_max_uses: null, p_hours_valid: 168
    });
    if (error) setNotice('Hikâye daveti oluşturulamadı: ' + error.message);
    else {
      const url = window.location.origin + window.location.pathname + '?story_invite=' + encodeURIComponent(data);
      setStoryInviteLinks(items => ({ ...items, [storyId]: url }));
      await copyLink(url);
      setNotice('7 gün geçerli hikâye daveti oluşturuldu ve kopyalandı.');
    }
    setStoryBusy(false);
  }

  async function createChapter(event) {
    event.preventDefault();
    if (!activeStory || !newChapterTitle.trim()) return;
    setStoryBusy(true);
    const { data, error } = await supabase.from('chapters').insert({
      story_id: activeStory.id, title: newChapterTitle.trim(),
      content: '', status: 'draft', created_by: userId,
      sort_order: chapters.length ? Math.max(...chapters.map(item => item.sort_order || 0)) + 1 : 1
    }).select().single();
    if (error) setNotice('Bölüm oluşturulamadı: ' + error.message);
    else {
      setChapters(items => [...items, data]);
      setActiveChapterId(data.id);
      setNewChapterTitle('');
      setEditorTitle(data.title);
      setEditorBlocks([]);
      setEditorContent('');
      setEditorStatus('draft');
      setEditorDirty(false);
      setShowRevisions(false);
      setFocusMode(true);
      setNotice('Yeni bölüm açıldı. Yazmaya başlayabilirsin.');
    }
    setStoryBusy(false);
  }

  async function saveChapter(event) {
    event.preventDefault();
    if (!activeChapter || !editorTitle.trim()) return;
    setBusy(true);
    const richCanvas = document.querySelector('.writer-rich-canvas');
    let blocksToSave = editorBlocks.map(block => ({ id: block.id || null, content: block.content }));
    if (richCanvas) {
      const usedIds = new Set();
      blocksToSave = Array.from(richCanvas.children).map(node => {
        const rawId = node.getAttribute('data-block-id');
        const id = rawId && !usedIds.has(rawId) ? rawId : null;
        if (id) usedIds.add(id);
        return {
          id,
          content: String(node.innerText || node.textContent || '').replace(/\r/g, '').replace(/\u00a0/g, ' ').trimEnd()
        };
      }).filter(block => block.content.trim());
    }
    const { error } = await supabase.rpc('save_chapter_blocks', {
      p_chapter_id: activeChapter.id, p_title: editorTitle.trim(), p_status: editorStatus,
      p_blocks: blocksToSave
    });
    const { data } = error ? { data: null } : await supabase.from('chapters').select('*').eq('id', activeChapter.id).single();
    if (error) setNotice('Bölüm kaydedilemedi: ' + error.message);
    else {
      setChapters(items => items.map(item => item.id === data.id ? data : item));
      await loadChapterBlocks(activeChapter.id);
      setEditorDirty(false);
      setNotice('Bölüm kaydedildi. Paragraf katkıları yazarlarla eşleştirildi.');
    }
    setBusy(false);
  }

  async function openChapter(chapter) {
    if (editorDirty && !window.confirm('Kaydedilmemiş değişikliklerin var. Bölüm değiştirmek istiyor musun?')) return;
    setActiveChapterId(chapter.id);
    setEditorTitle(chapter.title);
    const loaded = await loadChapterBlocks(chapter.id);
    if (!loaded.length && chapter.content) {
      const legacyBlocks = chapter.content.split(/\n\s*\n/).filter(Boolean).map(content => ({id:null,content,author_id:null,updated_by:null}));
      setEditorBlocks(legacyBlocks);
      setEditorContent(chapter.content);
    }
    setEditorStatus(chapter.status || 'draft');
    setEditorDirty(false);
    setShowRevisions(false);
    setFocusMode(true);

  }

  async function deleteChapter() {
    if (!activeChapter || !isStoryOwner) return;
    if (!window.confirm('Bu bölümü ve sürüm geçmişini silmek istediğine emin misin?')) return;
    const { error } = await supabase.from('chapters').delete().eq('id', activeChapter.id);
    if (error) setNotice('Bölüm silinemedi: ' + error.message);
    else {
      setChapters(items => items.filter(item => item.id !== activeChapter.id));
      setActiveChapterId('');
      setEditorDirty(false);
      setNotice('Bölüm silindi.');
    }
  }

  async function loadRevisions() {
    if (!activeChapter) return;
    const { data, error } = await supabase.from('chapter_revisions')
      .select('id,title,content,editor_id,created_at')
      .eq('chapter_id', activeChapter.id).order('created_at', { ascending: false }).limit(20);
    if (error) setNotice('Sürüm geçmişi yüklenemedi: ' + error.message);
    else {
      setRevisions(data || []);
      setShowRevisions(true);
    }
  }

  async function restoreRevision(revision) {
    if (!activeChapter || !window.confirm('Bu eski sürümü bölümün güncel içeriği olarak geri yüklemek istiyor musun?')) return;
    setBusy(true);
    const restoredBlocks = revision.content.split(/\n\s*\n/).filter(text => text.trim()).map(content => ({id:null,content}));
    const { error } = await supabase.rpc('save_chapter_blocks', {
      p_chapter_id: activeChapter.id, p_title: revision.title, p_status: activeChapter.status,
      p_blocks: restoredBlocks
    });
    const { data } = error ? { data: null } : await supabase.from('chapters').select('*').eq('id', activeChapter.id).single();
    if (error) setNotice('Sürüm geri yüklenemedi: ' + error.message);
    else {
      setChapters(items => items.map(item => item.id === data.id ? data : item));
      setEditorTitle(data.title);
      setEditorContent(data.content);
      await loadChapterBlocks(activeChapter.id);
      setEditorStatus(data.status);
      setEditorDirty(false);
      setNotice('Önceki sürüm geri yüklendi.');
      await loadRevisions();
    }
    setBusy(false);
  }

  async function saveBookSettings(event) {
    event.preventDefault();
    if (role !== 'owner' || !book?.id) return;
    const targetWords = Number(settings.target_words);
    const extensionWords = Number(settings.extension_words);
    if (!Number.isInteger(targetWords) || targetWords < 100 || !Number.isInteger(extensionWords) || extensionWords < 100) {
      setNotice('Kelime hedefleri en az 100 ve tam sayı olmalı.');
      return;
    }
    setSettingsBusy(true);
    const { data, error } = await supabase.from('books').update({
      title: settings.title.trim() || 'Ortak Roman', subtitle: settings.subtitle.trim(),
      note: settings.note.trim(), target_words: targetWords, extension_words: extensionWords,
      updated_at: new Date().toISOString()
    }).eq('id', book.id).select().single();
    if (error) setNotice('Kitap ayarları kaydedilemedi: ' + error.message);
    else {
      setBook(data);
      setSettingsDirty(false);
      setNotice('Kitap ayarları kaydedildi.');
    }
    setSettingsBusy(false);
  }

  if (session && !authorized) {
    return <div className="setup"><div className="setup-card">
      <small>ORTAK ROMAN · HİKÂYE ERİŞİMİ</small>
      <h1>Hesabın henüz bir hikâyeye bağlı değil</h1>
      <p>{notice || 'Bu alan yalnızca hikâye üyelerine açıktır.'}</p>
      <p>Bir yazarın gönderdiği hikâye davet bağlantısını açıp e-posta girişini yeniden tamamla.</p>
      <button className="button light" onClick={() => supabase.auth.signOut()}>Çıkış yap</button>
    </div></div>;
  }

  const totalWords = chapters.reduce((sum, item) => sum + words(item.content || ''), 0);
  const publishedChapters = chapters.filter(item => item.status === 'published').length;
  const storyWordCount = chapters.reduce((sum,item) => sum + words(item.id === activeChapterId ? editorContent : (item.content || '')),0);
  const chapterWordLimit = activeChapter?.target_words || 1000;
  const chapterOverLimit = Boolean(activeChapter && words(editorContent) > chapterWordLimit);
  const readerChapters = chapters.filter(item => item.status === 'published');
  const readerChapter = readerChapters[readingIndex] || readerChapters[0] || null;
  const readerPages = paginateBookText(readerChapter?.content || '');
  const readerPageStep = readerLayout === 'spread' ? 2 : 1;
  const readerMaxPageIndex = readerLayout === 'spread'
    ? Math.max(0, Math.ceil(readerPages.length / 2) * 2 - 2)
    : Math.max(0, readerPages.length - 1);

  function turnBookPage(direction) {
    if (readerTurn || readerLayout === 'scroll' || !readerPages.length) return;
    const nextIndex = readerPageIndex + direction * readerPageStep;
    if (nextIndex < 0 || nextIndex > readerMaxPageIndex) return;
    setReaderTurn(direction > 0 ? 'forward' : 'backward');
    window.setTimeout(() => {
      setReaderPageIndex(nextIndex);
      setReaderTurn(null);
    }, 520);
  }

  function exitWritingStudio() {
    if (editorDirty && !window.confirm('Kaydedilmemiş değişikliklerin var. Yazma alanından çıkmak istiyor musun?')) return;
    setFocusMode(false);
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href={window.location.pathname}>✦ ORTAK <b>ROMAN</b></a>
      {session ? <div className="account"><button className="text-button" onClick={()=>setView('home')}>Ana sayfa</button><button className="text-button" onClick={()=>setView('discover')}>Yazarları keşfet</button><button className="button light profile-nav-button" disabled={profileBusy} onClick={openProfile}>{profileBusy ? 'Açılıyor…' : 'Profilim'}</button><button className="button light" onClick={() => supabase.auth.signOut()}>Çıkış</button></div> : <span className="eyebrow">DAVETLİ YAZARLAR</span>}
    </header>
    <main className={session ? 'content workspace-content' : 'content login-content'}>
      {!session ? <div className="login-layout">
        <section className="login-hero">
          <div className="login-hero-copy">
            <span className="eyebrow">BİRLİKTE YAZILAN BİR HİKÂYE</span>
            <h1>Her hikâye<br/><em>bir sesle</em> başlar.</h1>
            <p>Farklı zihinler, tek bir sayfada buluşur. Sen de davet edildiğin hikâyeye katıl; bir sonraki cümleyi birlikte yazalım.</p>
            <div className="login-signature"><span>✳</span> Bir hikâye, birçok ses</div>
          </div>
          <div className="book-art" aria-hidden="true">
            <div className="book-art-glow"></div><div className="book-sheet sheet-back"></div>
            <div className="book-sheet sheet-front"><span>ORTAK ROMAN</span><i>“</i><strong>Bir hikâye,<br/>birçok ses.</strong><small>İLK SAYFA HENÜZ YAZILMADI</small></div>
            <span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✦</span>
          </div>
        </section>
        <section className="panel login-panel">
          <div className="login-panel-mark">✦</div><span className="eyebrow">DAVETLİ YAZARLAR İÇİN</span>
          <h2>Hikâyeye katıl.</h2>
          <p>Davet bağlantınla geldin. E-posta adresini bırak; sana güvenli bir giriş bağlantısı gönderelim.</p>
          <form onSubmit={signIn} className="login-form">
            <label htmlFor="login-email">E-POSTA ADRESİN</label>
            <input id="login-email" type="email" required placeholder="ornek@eposta.com" value={email} onChange={e => setEmail(e.target.value)} />
            <button className="button" disabled={busy}>{busy ? 'Gönderiliyor…' : 'Giriş bağlantısı gönder'} <span>→</span></button>
          </form>
          <div className="login-footnote"><span>◈</span> Yalnızca geçerli hikâye daveti olan kişiler katılabilir.</div>
        </section>
      </div> : <>
        {view === 'profile' ? <section className="profile-page">
          <div className="profile-page-heading"><button className="text-button" onClick={() => setView('workspace')}>← Çalışma alanına dön</button><span className="eyebrow">ORTAK ROMAN · YAZAR KARTI</span></div>
          <div className="profile-hero"><div className="profile-avatar">{(profile?.display_name || 'Y').slice(0,1).toLocaleUpperCase('tr-TR')}</div><div className="profile-identity"><span className="eyebrow">YAZAR · TOPLULUK PROFİLİ</span><h1>{profile?.display_name || 'Yazar'}</h1>{profile?.bio && <p className="profile-bio">{profile.bio}</p>}<p>Katılım: {profile?.member_since ? new Date(profile.member_since).toLocaleDateString('tr-TR',{year:'numeric',month:'long'}) : 'Yeni yazar'}</p><div className="profile-social-counts"><span><b>{profile?.followers_count ?? 0}</b> takipçi</span><span><b>{profile?.following_count ?? 0}</b> takip</span></div></div>{publicProfileId !== userId && <button className="button profile-follow-button" onClick={() => toggleFollow(publicProfileId,profile?.is_following)}>{profile?.is_following ? 'Takibi bırak' : '+ Takip et'}</button>}</div>
          <div className="profile-stats-grid">
            <article><strong>{profile?.stats?.stories_created ?? 0}</strong><span>Hikâye başlattı</span></article>
            <article><strong>{profile?.stats?.stories_joined ?? 0}</strong><span>Hikâyeye katıldı</span></article>
            <article><strong>{profile?.stats?.chapters_written ?? 0}</strong><span>Bölüm oluşturdu</span></article>
            <article><strong>{Number(profile?.stats?.words_authored_current || 0).toLocaleString('tr-TR')}</strong><span>Yazdığı paragraflardaki kelime</span></article>
            <article><strong>{profile?.stats?.paragraphs_written ?? 0}</strong><span>Yazdığı paragraf</span></article>
            <article><strong>{profile?.stats?.paragraphs_last_edited ?? 0}</strong><span>Başkasının paragrafına katkı</span></article>
            <article><strong>{profile?.stats?.writers_invited ?? 0}</strong><span>Davetle katılan yazar</span></article>
            <article><strong>{profile?.stats?.invite_links_created ?? 0}</strong><span>Davet bağlantısı oluşturdu</span></article>
            <article><strong>{profile?.stats?.chapter_edits ?? 0}</strong><span>Bölüm düzenlemesi</span></article>
            <article className="profile-stat-upcoming"><strong>Yakında</strong><span>Altı çizilen cümleler</span></article>
          </div>
          <p className="profile-stat-note">Kelime sayısı, ilk yazarı olduğun paragrafların güncel metninden hesaplanır; paragrafı sonradan düzenleyen kişinin eklediği veya çıkardığı kelimeler ayrı hesaplanmaz. Eski metinlerin yazarı bilinmediği için katkı istatistiklerine dahil edilmez. Cümle vurguları henüz kullanıma açılmadı.</p>
          {publicProfileId === userId && <form className="profile-edit-card" onSubmit={saveProfile}>
            <div><span className="eyebrow">KİŞİSEL ALAN</span><h2>Profilini düzenle</h2><p>Diğer hikâye üyeleri adını ve kısa tanıtımını görebilir.</p></div>
            <label>Görünen ad<input required minLength={2} maxLength={40} value={profileForm.display_name} onChange={e => setProfileForm(v => ({...v,display_name:e.target.value}))}/></label>
            <label>Hakkımda<textarea rows={4} maxLength={500} value={profileForm.bio} onChange={e => setProfileForm(v => ({...v,bio:e.target.value}))} placeholder="Kendinden ve yazmayı sevdiğin hikâyelerden bahset…"/></label>
            <div className="profile-edit-footer"><span>{profileForm.bio.length}/500</span><button className="button" disabled={profileBusy || !profileForm.display_name.trim()}>{profileBusy ? 'Kaydediliyor…' : 'Profili kaydet'}</button></div>
          </form>}
        </section> : view === 'discover' ? <section className="discover-page">
          <div className="discover-heading"><span className="eyebrow">ORTAK ROMAN TOPLULUĞU</span><h1>Yazarları keşfet.</h1><p>Yeni sesler bul, yazarları takip et ve birlikte yazacağın insanlarla tanış.</p><input value={authorQuery} onChange={e => {setAuthorQuery(e.target.value);loadDiscover(e.target.value);}} placeholder="Yazar veya ilgi alanı ara…" aria-label="Yazar ara"/></div>
          <div className="discover-grid">{discoverAuthors.map(author => <article className="author-card" key={author.id}><button className="author-card-main" onClick={() => openProfile(author.id)}><span className="profile-avatar">{(author.display_name || 'Y').slice(0,1).toLocaleUpperCase('tr-TR')}</span><strong>{author.display_name}</strong><p>{author.bio || 'Henüz kendini tanıtmadı.'}</p><small>{author.followers_count} takipçi · {author.following_count} takip</small></button><div className="author-card-actions"><button className="button light" onClick={() => openProfile(author.id)}>Profili gör</button><button className="button" onClick={() => toggleFollow(author.id,author.is_following)}>{author.is_following ? 'Takibi bırak' : 'Takip et'}</button></div></article>)}</div>
          {!discoverAuthors.length && <div className="chapter-empty"><span>✦</span><h2>Henüz eşleşen yazar yok.</h2><p>Başka bir isimle ara veya topluluğa yeni yazarlar davet et.</p></div>}
        </section> : view === 'reader' ? <section className="reader-page">
          <div className="reader-topline"><button className="text-button" onClick={() => setView('workspace')}>← Çalışma alanı</button><span className="eyebrow">ORTAK ROMAN · KİTAP OKUYUCU</span><button className="text-button" onClick={() => setView('home')}>Kitaplığıma dön</button></div>
          <div className="reader-toolbar">
            <label>BÖLÜM <select value={readerChapter?.id || ''} onChange={e=>{const index=readerChapters.findIndex(item=>item.id===e.target.value);setReadingIndex(Math.max(0,index));setReaderPageIndex(0);}}>{readerChapters.map((chapter,index)=><option key={chapter.id} value={chapter.id}>{String(index+1).padStart(2,'0')} · {chapter.title}</option>)}</select></label>
            <label>OKUMA DÜZENİ <select value={readerLayout} onChange={e=>{setReaderLayout(e.target.value);setReaderPageIndex(0);setReaderTurn(null);}}><option value="spread">Açık kitap · iki sayfa</option><option value="single">Tek sayfa</option><option value="scroll">Kesintisiz kaydırma</option></select></label>
          </div>
          <div className={'reader-book reader-layout-' + readerLayout}>
            <div className="reader-running-head"><span>{book?.title || 'Ortak Roman'}</span><span>{activeStory?.title || ''}</span></div>
            {!readerChapter ? <div className="reader-empty"><span>✦</span><h2>Bu kitapta henüz yayınlanmış bölüm yok.</h2><p>Bir bölüm yayınlandığında burada okunabilir.</p></div> : readerLayout === 'scroll' ? <article className="reader-scroll-sheet">
              <span className="eyebrow">BÖLÜM {String(readingIndex+1).padStart(2,'0')}</span><h1>{readerChapter.title}</h1>
              <div className="reader-prose">{readerChapter.content.split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
            </article> : <div className={'reader-spread' + (readerTurn ? ' turning-' + readerTurn : '')}>
              <article className="reader-page-sheet page-left">
                <span className="reader-page-kicker">{readerPageIndex === 0 ? readerChapter.title : 'ORTAK ROMAN'}</span>
                <div className="reader-page-prose">{(readerPages[readerPageIndex] || '').split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
                <span className="reader-page-number">{readerPageIndex+1}</span>
              </article>
              <article className="reader-page-sheet page-right">
                <span className="reader-page-kicker">{readerChapter.title}</span>
                <div className="reader-page-prose">{(readerPages[readerPageIndex+1] || '').split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
                <span className="reader-page-number">{Math.min(readerPageIndex+2,readerPages.length)}</span>
              </article>
              {readerTurn && <div className={'page-flip-overlay ' + readerTurn}><div className="page-flip-front"><span>{readerChapter.title}</span><p>{(readerPages[readerTurn==='forward'?readerPageIndex+1:readerPageIndex] || '').slice(0,450)}</p></div><div className="page-flip-back"></div></div>}
            </div>}
            <div className="reader-controls">
              <button className="button light" disabled={readingIndex===0 && readerPageIndex===0} onClick={()=>{if(readerLayout!=='scroll' && readerPageIndex>0)turnBookPage(-1);else if(readingIndex>0){setReadingIndex(i=>i-1);setReaderPageIndex(0);}}}>← Önceki</button>
              <span>{readerLayout==='scroll' ? 'Bölüm '+(readingIndex+1)+' / '+readerChapters.length : 'Sayfa '+(Math.min(readerPageIndex+1,readerPages.length)||0)+'–'+(Math.min(readerPageIndex+(readerLayout==='spread'?2:1),readerPages.length)||0)+' / '+readerPages.length}</span>
              <button className="button" disabled={readingIndex>=readerChapters.length-1 && (readerLayout==='scroll' || readerPageIndex>=readerMaxPageIndex)} onClick={()=>{if(readerLayout!=='scroll' && readerPageIndex<readerMaxPageIndex)turnBookPage(1);else if(readingIndex<readerChapters.length-1){setReadingIndex(i=>i+1);setReaderPageIndex(0);}}}>Sonraki →</button>
            </div>
          </div>
        </section> : view === 'home' ? <section className="home-page">
          <div className="home-welcome"><div><span className="eyebrow">KİTAPLIĞIN · YAZAR TOPLULUĞU</span><h1>Her kitabın<br/><em>bir başlangıcı</em> vardır.</h1><p>Bir hikâyeyi tek başına başlatabilir, başka yazarlarla birlikte büyütebilirsin.</p><div className="home-actions"><button className="button" onClick={()=>setView('workspace')}>Yazmaya devam et <span>→</span></button><button className="button light" onClick={()=>setView('reader')}>Kitabı oku</button></div></div><div className="home-book-object"><div className="home-book-spine"></div><div className="home-book-cover"><small>ORTAK ROMAN</small><span>✦</span><strong>{book?.title || 'Bir hikâye, birçok ses'}</strong><i>Birlikte yazılan hikâyeler</i></div></div></div>
          <div className="home-section-head"><div><span className="eyebrow">SENİN KÜTÜPHANEN</span><h2>Hikâyelerine dön</h2></div><button className="text-button" onClick={()=>setView('workspace')}>Tüm hikâyeler →</button></div>
          <div className="home-story-grid">{stories.slice(0,3).map((story,i)=><button className={'home-story-card cover-tone-'+i} key={story.id} onClick={()=>{setActiveStoryId(story.id);setView('workspace');}}><span>✦</span><strong>{story.title}</strong><small>{story.description || 'Birlikte yazılmayı bekleyen bir hikâye'}</small></button>)}{!stories.length&&<p className="empty-small">Henüz hikâyen yok. Çalışma alanından ilk hikâyeni oluştur.</p>}</div>
          <div className="home-community-strip"><div><span className="eyebrow">YAZAR TOPLULUĞU</span><h2>Yeni bir ses keşfet.</h2><p>Yazarları bul, takip et ve hikâyelerine davet et.</p></div><button className="button" onClick={()=>setView('discover')}>Yazarları keşfet →</button></div>
        </section> : <>
        <section className="workspace-heading">
          <div><span className="eyebrow">YAZAR ÇALIŞMA ALANI</span><h1>{book?.title || 'Ortak Roman'}</h1><p>{book?.subtitle || 'Bir hikâye, birçok ses'}</p></div>
          <div className="workspace-stats"><strong>{stories.length}</strong><span>hikâye</span><i></i><strong>{publishedChapters}</strong><span>yayındaki bölüm</span></div>
        </section>
        <section className="workspace-grid">
          <aside className="workspace-sidebar">
            <div className="sidebar-heading"><div><span className="eyebrow">KÜTÜPHANE</span><h2>Hikâyeler</h2></div><span className="story-count">{stories.length}</span></div>
            <div className="story-nav">
              {stories.map(story => <button key={story.id} className={'story-nav-item' + (story.id === activeStoryId ? ' active' : '')} onClick={() => {
                if (editorDirty && !window.confirm('Kaydedilmemiş değişikliklerin var. Hikâye değiştirmek istiyor musun?')) return;
                setEditorDirty(false); setActiveStoryId(story.id); setShowRevisions(false);
              }}>
                <span className="story-nav-icon">✳</span><span><strong>{story.title}</strong><small>{story.owner_id === userId ? 'Senin hikâyen' : 'Katıldığın hikâye'}</small></span>
              </button>)}
              {!stories.length && <p className="empty-small">Henüz hikâye yok. İlk hikâyeni oluştur.</p>}
            </div>
            {activeStory && <div className="sidebar-invite">
              <button className="button light full" disabled={storyBusy} onClick={() => makeStoryInvite(activeStory.id)}>↗ Yazar davet et</button>
              {storyInviteLinks[activeStory.id] && <div className="story-link-copy"><input readOnly value={storyInviteLinks[activeStory.id]} onFocus={e => e.target.select()} /><button className="button light" onClick={() => copyLink(storyInviteLinks[activeStory.id])}>Kopyala</button></div>}
            </div>}
            <div className="new-story">
              <span className="eyebrow">YENİ BİR BAŞLANGIÇ</span>
              <form onSubmit={createStory}>
                <input required maxLength={120} value={newStoryTitle} onChange={e => setNewStoryTitle(e.target.value)} placeholder="Hikâyenin adı" aria-label="Yeni hikâye adı"/>
                <textarea rows={2} maxLength={600} value={newStoryDescription} onChange={e => setNewStoryDescription(e.target.value)} placeholder="Kısa açıklama (isteğe bağlı)" aria-label="Hikâye açıklaması"/>
                <button className="button full" disabled={storyBusy || !newStoryTitle.trim() || !book?.id}>{storyBusy ? 'Oluşturuluyor…' : '+ Hikâye oluştur'}</button>
              </form>
            </div>
          </aside>

          <section className="workspace-main">
            {activeStory ? <>
              <div className="story-heading">
                <div><span className="eyebrow">SEÇİLİ HİKÂYE</span><h2>{activeStory.title}</h2><p>{activeStory.description || 'Bu hikâyenin dünyası henüz tanımlanmadı.'}</p></div>
                <div className="story-heading-actions"><span className="story-word-meter">{chapters.reduce((n,c)=>n+words(c.content||''),0).toLocaleString('tr-TR')} / {(activeStory.target_words||10000).toLocaleString('tr-TR')} kelime</span><button className="button light" onClick={()=>{setReadingIndex(0);setReaderPageIndex(0);setView('reader');}}>Kitabı oku</button><span className={'status-pill ' + activeStory.status}>{activeStory.status === 'published' ? 'Yayında' : activeStory.status === 'archived' ? 'Arşiv' : 'Taslak'}</span><button className="button light" disabled={storyBusy} onClick={() => makeStoryInvite(activeStory.id)}>Davet bağlantısı</button>{isStoryOwner && <button className="button light danger-button" disabled={storyBusy} onClick={deleteStory}>Hikâyeyi sil</button>}</div>
              </div>

              {isStoryOwner && <div className="story-target-control"><label>Hikâye kelime hedefi <input type="number" min="100" max="1000000" step="100" value={activeStory.target_words || 10000} onChange={e=>{const target_words=Number(e.target.value);setStories(items=>items.map(s=>s.id===activeStory.id?{...s,target_words}:s));}} onBlur={async e=>{const {error}=await supabase.from('stories').update({target_words:Number(e.target.value),updated_at:new Date().toISOString()}).eq('id',activeStory.id);if(error)setNotice('Hedef güncellenemedi: '+error.message);else setNotice('Hikâye kelime hedefi güncellendi.');}}/></label><span>{storyWordCount.toLocaleString('tr-TR')} / {(activeStory.target_words||10000).toLocaleString('tr-TR')} kelime · Hikâyedeki tüm bölümlerin toplamı</span></div>}
              <div className="chapter-layout">
                <aside className="chapter-sidebar">
                  <div className="chapter-sidebar-title"><h3>Bölümler</h3><span>{chapters.length}</span></div>
                  {chapters.map((chapter,index) => <button key={chapter.id} className={'chapter-nav-item' + (chapter.id === activeChapterId ? ' active' : '')} onClick={() => openChapter(chapter)}>
                    <small>{String(index+1).padStart(2,'0')}</small><span><strong>{chapter.title}</strong><em>{chapter.status === 'published' ? 'Yayında' : 'Taslak'}</em></span>
                  </button>)}
                  {!chapters.length && <p className="empty-small">Bu hikâyede henüz bölüm yok.</p>}
                  <form className="new-chapter-form" onSubmit={createChapter}>
                    <input required maxLength={120} value={newChapterTitle} onChange={e => setNewChapterTitle(e.target.value)} placeholder="Yeni bölüm başlığı" aria-label="Yeni bölüm başlığı"/>
                    <button className="button light full" disabled={storyBusy || !newChapterTitle.trim()}>+ Bölüm ekle</button>
                  </form>
                </aside>

                <div className={'chapter-editor-wrap' + (focusMode ? ' focus-mode focus-width-' + writingWidth : '')}>
                  {activeChapter ? <form className="chapter-editor" onSubmit={saveChapter}>
                    <div className="editor-toolbar">
                      {focusMode ? <div className="writer-studio-brand"><button type="button" className="writer-back-button" onClick={exitWritingStudio} aria-label="Çalışma alanına dön">←</button><div><span className="writer-studio-book">{activeStory?.title || 'Ortak Roman'}</span><strong>{editorTitle || 'Yeni bölüm'}</strong></div></div> : <span className="eyebrow">BÖLÜM DÜZENLEYİCİ</span>}
                      <div className="writer-toolbar-actions">
                        <span className="save-state">{editorDirty ? '● Kaydedilmedi' : '✓ Kaydedildi'}</span>
                        {focusMode ? <button type="button" className="writer-exit-button" onClick={exitWritingStudio}>Çalışma alanına dön</button> : <button type="button" className="text-button" onClick={() => setFocusMode(true)}>⛶ Odak modunda yaz</button>}
                        {isStoryOwner && !focusMode && <button type="button" className="text-button danger" onClick={deleteChapter}>Bölümü sil</button>}
                      </div>
                    </div>
                    {focusMode && <div className="focus-width-controls">
                      <div className="writer-format-group">
                        <label>YAZI <select value={writingFont} onChange={e=>setWritingFont(e.target.value)}><option value="serif">Kitap serif</option><option value="sans">Modern</option><option value="typewriter">Daktilo</option></select></label>
                        <label>PUNTO <select value={writingSize} onChange={e=>setWritingSize(e.target.value)}><option value="17">17</option><option value="18">18</option><option value="20">20</option><option value="22">22</option><option value="24">24</option></select></label>
                        <label>SATIR <select value={writingLineHeight} onChange={e=>setWritingLineHeight(e.target.value)}><option value="1.6">Sıkı</option><option value="1.8">Normal</option><option value="1.95">Rahat</option><option value="2.1">Geniş</option></select></label>
                      </div>
                      <div className="writer-layout-group"><button type="button" className={writingWidth === 'notebook' ? 'active' : ''} onClick={() => setWritingWidth('notebook')}>Defter</button><button type="button" className={writingWidth === 'wide' ? 'active' : ''} onClick={() => setWritingWidth('wide')}>Word sayfası</button></div>
                      <span className="focus-word-count">{words(editorContent).toLocaleString('tr-TR')} kelime</span>
                    </div>}
                    <input className="chapter-title-input" required maxLength={120} value={editorTitle} onChange={e => {setEditorTitle(e.target.value);setEditorDirty(true);}} aria-label="Bölüm başlığı" placeholder="Bölüm başlığı"/>
                    <div className="editor-meta"><span>{words(editorContent).toLocaleString('tr-TR')} / {(activeChapter.target_words||1000).toLocaleString('tr-TR')} kelime</span><label>Durum <select value={editorStatus} onChange={e => {setEditorStatus(e.target.value);setEditorDirty(true);}}><option value="draft">Taslak</option><option value="published">Yayında</option></select></label><label>Bölüm hedefi <input className="inline-word-target" type="number" min="100" max="100000" step="100" value={activeChapter.target_words || 1000} onChange={async e=>{const target_words=Number(e.target.value);setChapters(items=>items.map(c=>c.id===activeChapter.id?{...c,target_words}:c));}} onBlur={async e=>{const {error}=await supabase.from('chapters').update({target_words:Number(e.target.value),updated_at:new Date().toISOString()}).eq('id',activeChapter.id);if(error)setNotice('Bölüm hedefi güncellenemedi: '+error.message);else setNotice('Bölüm kelime hedefi güncellendi.');}}/></label></div>
                    {chapterOverLimit && <div className="word-limit-warning">Bölüm kelime sınırını aştın. Kaydedebilmek için {Math.max(0,words(editorContent)-chapterWordLimit)} kelime azalt veya bölüm hedefini yükselt.</div>}
                    {writingLock && <div className={'writing-presence ' + (writingLock.acquired ? 'is-self' : 'is-other')}><span className="writing-pencil">✎</span>{writingLock.acquired ? 'Şu anda bu bölümü sen yazıyorsun. Sıra sende.' : (writingLock.display_name || 'Bir yazar') + ' şu anda yazıyor · Bu bölüm geçici olarak kilitli.'}</div>}
                    <div className={'chapter-blocks-editor' + (focusMode ? ' document-page-canvas' : '')} aria-label="Paragraf yazma alanı">
                      {focusMode ? <div
                        className="writer-rich-canvas"
                        contentEditable={Boolean(writingLock?.acquired)}
                        suppressContentEditableWarning
                        role="textbox"
                        aria-label="Hikâye metni"
                        aria-multiline="true"
                        data-placeholder="Hikâyenin ilk cümlesini yaz…"
                        style={{fontFamily:writingFont==='sans'?'Arial, sans-serif':writingFont==='typewriter'?'Courier New, monospace':"'EB Garamond', Georgia, serif",fontSize:writingSize+'px',lineHeight:writingLineHeight}}
                        onInput={e=>{setEditorContent(e.currentTarget.innerText.replace(/\r/g,'').replace(/\u00a0/g,' '));setEditorDirty(true);}}
                      >
                        {editorBlocks.map((block,index)=><p key={block.id || 'legacy-'+index} data-block-id={block.id || ''}>{block.content || <br/>}</p>)}
                      </div> : <>
                        {editorBlocks.map((block,index)=><div className="chapter-block" key={block.id || 'new-'+index}>
                          <textarea className="chapter-content-input chapter-block-input" disabled={!writingLock?.acquired} rows={Math.max(3,block.content.split('\n').length)} value={block.content} onChange={e=>{
                            const next=editorBlocks.map((item,i)=>i===index?{...item,content:e.target.value}:item);
                            setEditorBlocks(next);setEditorContent(next.map(item=>item.content).join('\n\n'));setEditorDirty(true);
                          }} placeholder="Paragrafını buraya yaz…" aria-label={'Paragraf '+(index+1)}/>
                          <div className="chapter-block-meta"><span>{block.author_id ? (block.author_id===userId?'İlk yazar: Sen':'İlk yazar: '+block.author_name) : 'Eski metin · İlk yazarı bilinmiyor'}{block.updated_by && block.updated_by!==block.author_id?' · Son düzenleyen: '+(block.updated_by===userId?'Sen':block.editor_name):''} · {words(block.content)} kelime</span>
                            <button type="button" className="text-button danger" disabled={!writingLock?.acquired} onClick={()=>{const next=editorBlocks.filter((_,i)=>i!==index);setEditorBlocks(next);setEditorContent(next.map(item=>item.content).join('\n\n'));setEditorDirty(true);}}>Paragrafı kaldır</button>
                          </div>
                        </div>)}
                        <button type="button" className="add-paragraph-button" disabled={!writingLock?.acquired} onClick={()=>{setEditorBlocks(items=>[...items,{id:null,content:'',author_id:userId}]);setEditorDirty(true);}}>＋ Yeni paragraf ekle</button>
                      </>}
                    </div>
                    <div className="editor-footer"><button type="button" className="button light" onClick={loadRevisions}>Sürüm geçmişi</button><button className="button" disabled={busy || !writingLock?.acquired || chapterOverLimit || !editorTitle.trim() || !editorDirty}>{busy ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}</button></div>
                    {showRevisions && <div className="revision-list"><div className="revision-heading"><strong>Önceki sürümler</strong><button type="button" className="text-button" onClick={() => setShowRevisions(false)}>Kapat</button></div>
                      {revisions.length ? revisions.map(revision => <article key={revision.id}><div><strong>{revision.title}</strong><small>{new Date(revision.created_at).toLocaleString('tr-TR')} · {words(revision.content)} kelime</small></div><button type="button" className="button light" onClick={() => restoreRevision(revision)}>Geri yükle</button></article>) : <p>Henüz önceki bir sürüm yok.</p>}
                    </div>}
                  </form> : <div className="chapter-empty"><span>✳</span><h3>İlk bölümü yazmaya başla.</h3><p>Bu hikâyeye bir bölüm ekle; davet ettiğin yazarlar da birlikte geliştirebilir.</p></div>}
                </div>
              </div>
            </> : <div className="chapter-empty welcome-empty"><span>✦</span><h2>Bir hikâyeyle başlayalım.</h2><p>Soldaki alandan yeni bir hikâye oluştur. Her hikâyenin kendi yazarları, davetleri ve bölümleri olacak.</p></div>}
          </section>
        </section>
        {role === 'owner' && <section className="panel settings-panel workspace-settings">
          <span className="eyebrow">ANA YÖNETİCİ · KİTAP AYARLARI</span><h2>Kitap bilgileri</h2>
          <form onSubmit={saveBookSettings}>
            <label>Kitap başlığı<input required maxLength={100} value={settings.title} onChange={e => {setSettings(v => ({...v,title:e.target.value}));setSettingsDirty(true);}}/></label>
            <label>Alt başlık<input maxLength={160} value={settings.subtitle} onChange={e => {setSettings(v => ({...v,subtitle:e.target.value}));setSettingsDirty(true);}}/></label>
            <label>Kitap açıklaması<textarea rows={3} value={settings.note} onChange={e => {setSettings(v => ({...v,note:e.target.value}));setSettingsDirty(true);}}/></label>
            <div className="settings-numbers"><label>Kelime hedefi<input type="number" min="100" step="100" value={settings.target_words} onChange={e => {setSettings(v => ({...v,target_words:e.target.value}));setSettingsDirty(true);}}/></label><label>Uzatma miktarı<input type="number" min="100" step="100" value={settings.extension_words} onChange={e => {setSettings(v => ({...v,extension_words:e.target.value}));setSettingsDirty(true);}}/></label></div>
            <div className="settings-actions"><span>Değişiklikler tüm kitap alanına yansır.</span><button className="button" disabled={settingsBusy || !settingsDirty}>{settingsBusy ? 'Kaydediliyor…' : 'Ayarları kaydet'}</button></div>
          </form>
        </section>}
        </>}
      </>}
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Bildirimi kapat">×</button></div>}
    </main>
    <footer className="site-footer">ORTAK ROMAN <span>Birlikte yazılır.</span></footer>
  </div>;
}
