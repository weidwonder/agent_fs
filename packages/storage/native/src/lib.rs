use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub struct AFDStorage {}

#[napi]
impl AFDStorage {
  #[napi(constructor)]
  pub fn new(_documents_dir: String, _cache_size: Option<u32>) -> Self {
    Self {}
  }

  #[napi]
  pub async fn write(
    &self,
    _file_id: String,
    _files: std::collections::HashMap<String, Either<String, Buffer>>,
  ) -> Result<()> {
    Err(Error::from_reason("NotImplemented"))
  }

  #[napi]
  pub async fn read(&self, _file_id: String, _file_path: String) -> Result<Buffer> {
    Err(Error::from_reason("NotImplemented"))
  }

  #[napi]
  pub async fn read_text(&self, _file_id: String, _file_path: String) -> Result<String> {
    Err(Error::from_reason("NotImplemented"))
  }

  #[napi]
  pub async fn read_batch(&self, _requests: Vec<ReadRequest>) -> Result<Vec<Buffer>> {
    Err(Error::from_reason("NotImplemented"))
  }

  #[napi]
  pub async fn exists(&self, _file_id: String) -> Result<bool> {
    Ok(false)
  }

  #[napi]
  pub async fn delete(&self, _file_id: String) -> Result<()> {
    Ok(())
  }
}

#[napi(object)]
pub struct ReadRequest {
  pub file_id: String,
  pub file_path: String,
}
