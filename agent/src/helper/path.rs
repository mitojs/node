use std::env;

pub fn get_tmp_path() -> String {
    env::temp_dir().to_string_lossy().to_string()
}
