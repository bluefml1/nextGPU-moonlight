use std::{env, path::PathBuf, process::Command};

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_os != "macos" || target_arch != "x86_64" {
        return;
    }

    // moonlight-common-sys pulls C objects that reference ___cpu_model on x86_64 macOS.
    // Link the compiler-rt archive that defines that symbol.
    let output = Command::new("clang").arg("--print-resource-dir").output();
    let Ok(output) = output else {
        println!("cargo:warning=clang not found; skipping libclang_rt.osx linkage");
        return;
    };
    if !output.status.success() {
        println!("cargo:warning=failed to query clang resource dir; skipping libclang_rt.osx linkage");
        return;
    }

    let resource_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if resource_dir.is_empty() {
        println!("cargo:warning=empty clang resource dir; skipping libclang_rt.osx linkage");
        return;
    }

    let mut darwin_lib_dir = PathBuf::from(resource_dir);
    darwin_lib_dir.push("lib");
    darwin_lib_dir.push("darwin");

    if !darwin_lib_dir.exists() {
        println!(
            "cargo:warning=clang darwin runtime dir missing at {}; skipping libclang_rt.osx linkage",
            darwin_lib_dir.display()
        );
        return;
    }

    println!("cargo:rustc-link-search=native={}", darwin_lib_dir.display());
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}
