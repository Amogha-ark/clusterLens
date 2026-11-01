package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"clusterlens/backend/internal/cluster"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func main() {
	kubeconfig := flag.String("kubeconfig", "artifacts/clusterlens.kubeconfig", "Explicit kubeconfig; empty uses in-cluster identity")
	kubecontext := flag.String("context", "k3d-clusterlens", "Explicit context for local kubeconfig")
	addr := flag.String("listen", "127.0.0.1:8080", "HTTP listen address")
	static := flag.String("static", "frontend/dist", "Built dashboard directory")
	name := flag.String("cluster-id", "clusterlens-local", "Stable cluster identity")
	flag.Parse()
	var config *rest.Config
	var err error
	if *kubeconfig == "" {
		config, err = rest.InClusterConfig()
	} else {
		rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: *kubeconfig}
		overrides := &clientcmd.ConfigOverrides{CurrentContext: *kubecontext}
		config, err = clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides).ClientConfig()
	}
	if err != nil {
		log.Fatalf("Kubernetes configuration: %v", err)
	}
	config.Timeout = 20 * time.Second
	config.QPS = 15
	config.Burst = 30
	config.UserAgent = "clusterlens/0.1"
	dyn, err := dynamic.NewForConfig(config)
	if err != nil {
		log.Fatal(err)
	}
	kube, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Fatal(err)
	}
	metrics, err := metricsclient.NewForConfig(config)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ai, err := cluster.AIFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	defer ai.Close()
	store := cluster.New(*name, dyn, kube, metrics)
	store.Start(ctx)
	server := &http.Server{Addr: *addr, Handler: store.Handler(*static, ai), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384, BaseContext: func(net.Listener) context.Context { return ctx }}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("ClusterLens listening on http://%s (cluster %s)", *addr, *name)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
