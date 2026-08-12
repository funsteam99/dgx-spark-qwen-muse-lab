FROM nvcr.io/nvidia/vllm:26.03-py3

ARG LLAMA_REF=b10353

RUN git clone --branch "${LLAMA_REF}" --depth 1 \
      https://github.com/ggml-org/llama.cpp /opt/llama.cpp \
    && cmake -S /opt/llama.cpp -B /opt/llama.cpp/build \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_CUDA=ON \
      -DGGML_NATIVE=OFF \
      -DGGML_CUDA_FA_ALL_QUANTS=ON \
      -DCMAKE_CUDA_ARCHITECTURES=121 \
      -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /opt/llama.cpp/build --target llama-server -j 8 \
    && rm -rf /opt/llama.cpp/.git

ENTRYPOINT ["/opt/llama.cpp/build/bin/llama-server"]
