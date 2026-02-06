use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Arc;

use lru::LruCache;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use rayon::prelude::*;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[napi]
pub struct AFDStorage {
  documents_dir: PathBuf,
  cache: Arc<Mutex<LruCache<String, Arc<Vec<u8>>>>>,
}

#[napi]
impl AFDStorage {
  #[napi(constructor)]
  pub fn new(documents_dir: String, cache_size: Option<u32>) -> Result<Self> {
    let documents_dir = PathBuf::from(documents_dir);
    fs::create_dir_all(&documents_dir)
      .map_err(|err| Error::from_reason(format!("创建 documents 目录失败: {err}")))?;

    let cache_size = cache_size.unwrap_or(100) as usize;
    let cache_size = NonZeroUsize::new(cache_size).unwrap_or_else(|| {
      NonZeroUsize::new(1).expect("cache size fallback must be non-zero")
    });

    Ok(Self {
      documents_dir,
      cache: Arc::new(Mutex::new(LruCache::new(cache_size))),
    })
  }

  #[napi]
  pub async fn write(
    &self,
    file_id: String,
    files: HashMap<String, Either<String, Buffer>>,
  ) -> Result<()> {
    let afd_path = self.archive_path(&file_id);
    let archive_bytes = Arc::new(Self::build_archive_bytes(files)?);

    fs::write(&afd_path, archive_bytes.as_slice())
      .map_err(|err| Error::from_reason(format!("写入 AFD 文件失败: {err}")))?;

    self.cache.lock().put(file_id, archive_bytes);
    Ok(())
  }

  #[napi]
  pub async fn read(&self, file_id: String, file_path: String) -> Result<Buffer> {
    self
      .read_sync(&file_id, &file_path)
      .map(Buffer::from)
  }

  #[napi]
  pub async fn read_text(&self, file_id: String, file_path: String) -> Result<String> {
    let bytes = self.read_sync(&file_id, &file_path)?;
    String::from_utf8(bytes).map_err(|err| {
      Error::from_reason(format!(
        "读取文本失败，文件不是合法 UTF-8: file_id={file_id}, path={file_path}, error={err}"
      ))
    })
  }

  #[napi]
  pub async fn read_batch(&self, requests: Vec<ReadRequest>) -> Result<Vec<Buffer>> {
    requests
      .par_iter()
      .map(|request| {
        self
          .read_sync(&request.file_id, &request.file_path)
          .map(Buffer::from)
      })
      .collect()
  }

  #[napi]
  pub async fn exists(&self, file_id: String) -> Result<bool> {
    Ok(self.archive_path(&file_id).exists())
  }

  #[napi]
  pub async fn delete(&self, file_id: String) -> Result<()> {
    let afd_path = self.archive_path(&file_id);
    match fs::remove_file(&afd_path) {
      Ok(()) => {}
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
      Err(err) => {
        return Err(Error::from_reason(format!("删除 AFD 文件失败: {err}")));
      }
    }

    self.cache.lock().pop(&file_id);
    Ok(())
  }
}

impl AFDStorage {
  fn archive_path(&self, file_id: &str) -> PathBuf {
    self.documents_dir.join(format!("{file_id}.afd"))
  }

  fn load_archive_bytes(&self, file_id: &str) -> Result<Arc<Vec<u8>>> {
    if let Some(cached) = self.cache.lock().get(file_id).cloned() {
      return Ok(cached);
    }

    let afd_path = self.archive_path(file_id);
    let bytes = fs::read(&afd_path).map_err(|err| {
      if err.kind() == std::io::ErrorKind::NotFound {
        Error::from_reason(format!("AFD 文件不存在: {}", afd_path.display()))
      } else {
        Error::from_reason(format!("读取 AFD 文件失败: {err}"))
      }
    })?;

    let bytes = Arc::new(bytes);
    self.cache.lock().put(file_id.to_owned(), bytes.clone());
    Ok(bytes)
  }

  fn read_sync(&self, file_id: &str, file_path: &str) -> Result<Vec<u8>> {
    let archive_bytes = self.load_archive_bytes(file_id)?;
    let cursor = Cursor::new(archive_bytes.as_slice());
    let mut archive = ZipArchive::new(cursor)
      .map_err(|err| Error::from_reason(format!("解析 AFD 失败: {err}")))?;

    let mut file = archive.by_name(file_path).map_err(|err| {
      Error::from_reason(format!(
        "AFD 中不存在目标文件: file_id={file_id}, path={file_path}, error={err}"
      ))
    })?;

    let mut output = Vec::new();
    file
      .read_to_end(&mut output)
      .map_err(|err| Error::from_reason(format!("读取 AFD 内文件失败: {err}")))?;

    Ok(output)
  }

  fn build_archive_bytes(files: HashMap<String, Either<String, Buffer>>) -> Result<Vec<u8>> {
    let cursor = Cursor::new(Vec::<u8>::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default()
      .compression_method(CompressionMethod::Deflated)
      .compression_level(Some(6));

    for (path, content) in files {
      writer
        .start_file(path.as_str(), options)
        .map_err(|err| Error::from_reason(format!("写入 ZIP 条目失败: {err}")))?;

      match content {
        Either::A(text) => writer
          .write_all(text.as_bytes())
          .map_err(|err| Error::from_reason(format!("写入文本内容失败: {err}")))?,
        Either::B(buffer) => writer
          .write_all(buffer.as_ref())
          .map_err(|err| Error::from_reason(format!("写入二进制内容失败: {err}")))?,
      }
    }

    let cursor = writer
      .finish()
      .map_err(|err| Error::from_reason(format!("完成 ZIP 写入失败: {err}")))?;

    Ok(cursor.into_inner())
  }
}

#[napi(object)]
pub struct ReadRequest {
  pub file_id: String,
  pub file_path: String,
}
